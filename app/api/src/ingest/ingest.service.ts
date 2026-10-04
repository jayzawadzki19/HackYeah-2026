import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { Webhook } from 'svix';
import type { SyncAcceptedDto, UserKey } from '../../../contracts/api-contract';
import { CALENDAR_PROVIDER, type CalendarProvider } from '../calendar/calendar.provider';
import { CLOCK, type Clock } from '../common/clock';
import { type SleepFn } from '../common/http';
import { conflict, invalidRequest } from '../common/problem';
import { isoInZone } from '../common/time';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { WebhookDeliveriesRepository } from '../db/repositories';
import { ForecastService } from '../forecast/forecast.service';
import { StreamBus } from '../stream/stream.bus';
import { USER_KEYS } from '../users/user-key';
import { ConnectorError, CONNECTOR_CLIENT, type ConnectorClient } from './connector.client';
import { SAMPLE_PROBE, type SampleProbe } from './sample-probe';
import { SyncStatus } from './sync-status';
import { BACKGROUND_EVERY_MS, DEBOUNCE_MS, DELAYER, pollUntilNewer, type DelayHandle, type Delayer } from './timing';

export const SLEEP = Symbol('Sleep');

const header = (headers: IncomingHttpHeaders, name: string): string => {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

const userIdOf = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const data = record.data;
  const nested = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).user_id : undefined;
  const candidate = typeof nested === 'string' ? nested : record.user_id;
  return typeof candidate === 'string' && candidate !== '' ? candidate : null;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

@Injectable()
export class IngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private readonly webhook: Webhook;
  private readonly pending = new Map<UserKey, DelayHandle>();
  private background: ReturnType<typeof setInterval> | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider,
    @Inject(CONNECTOR_CLIENT) private readonly connector: ConnectorClient,
    @Inject(SAMPLE_PROBE) private readonly probe: SampleProbe,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DELAYER) private readonly delayer: Delayer,
    @Inject(SLEEP) private readonly sleep: SleepFn,
    private readonly deliveries: WebhookDeliveriesRepository,
    private readonly forecasts: ForecastService,
    private readonly bus: StreamBus,
    private readonly syncStatus: SyncStatus,
  ) {
    this.webhook = new Webhook(config.openWearables.webhookSecret);
  }

  /** Svix-verified webhook. 204 for duplicates and unknown users; 400 when the signature fails. */
  receive(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): void {
    if (rawBody === undefined) throw invalidRequest('Missing request body.');
    const svixHeaders = {
      'svix-id': header(headers, 'svix-id'),
      'svix-timestamp': header(headers, 'svix-timestamp'),
      'svix-signature': header(headers, 'svix-signature'),
    };
    try {
      this.webhook.verify(rawBody, svixHeaders);
    } catch (error) {
      this.logger.warn(`Rejected open-wearables webhook (${error instanceof Error ? error.name : 'error'}).`);
      throw invalidRequest('Webhook signature could not be verified.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw invalidRequest('Webhook body is not JSON.');
    }
    if (svixHeaders['svix-id'] === '' || !this.deliveries.record(svixHeaders['svix-id'], this.clock.now())) return;
    const userKey = this.userKeyFor(userIdOf(payload));
    if (userKey === null) {
      this.logger.warn('Verified webhook did not match a known open-wearables user.');
      return;
    }
    this.syncStatus.markSynced(userKey, this.clock.now());
    this.schedule(userKey);
  }

  /** 202 once a live sync is queued. Synthetic users are a 409 problem. */
  async requestSync(userKey: UserKey): Promise<SyncAcceptedDto> {
    await this.assertLive(userKey);
    this.tail = this.tail.then(() => this.runSync(userKey)).catch((error: unknown) => {
      this.logger.error(`Sync now for ${userKey} failed: ${describe(error)}`);
    });
    return { accepted: true };
  }

  /** Runs one connector sync. Poll mode then waits for newer samples and recomputes. */
  async runSync(userKey: UserKey): Promise<void> {
    const profile = await this.calendar.profile(userKey);
    if (profile.isSynthetic) {
      throw conflict('synthetic-sync', 'Sync not available', 'Sync now applies to live Garmin data only. This user is a demo persona.');
    }
    const stamp = () => isoInZone(this.clock.now(), profile.timeZone);
    this.bus.publish(userKey, { type: 'sync.status', state: 'running', at: stamp() });
    try {
      const result = await this.connector.sync(userKey);
      this.syncStatus.markSynced(userKey, this.clock.now());
      this.bus.publish(userKey, {
        type: 'sync.status',
        state: 'ok',
        pushedRecords: result.pushedRecords,
        latestSampleAt: result.latestSampleAt,
        at: stamp(),
      });
      if (this.config.ingestMode !== 'poll') return;
      await this.waitForSamples(userKey, result.latestSampleAt);
      await this.forecasts.recompute(userKey);
    } catch (error) {
      const message = error instanceof ConnectorError ? error.message : 'Sync failed.';
      this.bus.publish(userKey, { type: 'sync.status', state: 'error', error: message, at: stamp() });
    }
  }

  /** Poll fallback for the connector's own loop: recompute every live user. */
  async refreshLiveUsers(): Promise<void> {
    for (const userKey of USER_KEYS) {
      try {
        const profile = await this.calendar.profile(userKey);
        if (profile.isSynthetic) continue;
        await this.forecasts.recompute(userKey);
      } catch (error) {
        this.logger.warn(`Background refresh for ${userKey} failed: ${describe(error)}`);
      }
    }
  }

  /** Resolves when queued Sync now runs have finished. */
  idle(): Promise<void> {
    return this.tail;
  }

  onModuleInit(): void {
    if (this.config.ingestMode !== 'poll') return;
    this.background = setInterval(() => {
      void this.refreshLiveUsers();
    }, BACKGROUND_EVERY_MS);
    this.background.unref?.();
  }

  onModuleDestroy(): void {
    for (const handle of this.pending.values()) handle.cancel();
    this.pending.clear();
    if (this.background !== null) clearInterval(this.background);
    this.background = null;
  }

  private async assertLive(userKey: UserKey): Promise<void> {
    const profile = await this.calendar.profile(userKey);
    if (profile.isSynthetic) {
      throw conflict('synthetic-sync', 'Sync not available', 'Sync now applies to live Garmin data only. This user is a demo persona.');
    }
  }

  private userKeyFor(owUserId: string | null): UserKey | null {
    if (owUserId === null) return null;
    return USER_KEYS.find((key) => this.config.owUserIds[key] === owUserId) ?? null;
  }

  private schedule(userKey: UserKey): void {
    this.pending.get(userKey)?.cancel();
    const handle = this.delayer.delay(DEBOUNCE_MS, () => {
      this.pending.delete(userKey);
      void this.forecasts.recompute(userKey).catch((error: unknown) => {
        this.logger.warn(`Recompute after webhook for ${userKey} failed: ${describe(error)}`);
      });
    });
    this.pending.set(userKey, handle);
  }

  private async waitForSamples(userKey: UserKey, latestSampleAt: string | null): Promise<void> {
    try {
      const found = await pollUntilNewer(
        () => this.probe.hasNewerThan(userKey, latestSampleAt, this.clock.now()),
        this.sleep,
      );
      if (!found) this.logger.warn(`No samples newer than the connector cursor for ${userKey}; recomputing anyway.`);
    } catch (error) {
      this.logger.warn(`Sample poll for ${userKey} failed: ${describe(error)}; recomputing anyway.`);
    }
  }
}
