import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import type { BriefingDto, EnergyMapDto, UserKey, WeekDto } from '../../../contracts/api-contract';
import { CALENDAR_PROVIDER, type CalendarProfile, type CalendarProvider } from '../calendar/calendar.provider';
import { CLOCK, type Clock } from '../common/clock';
import { unavailable } from '../common/problem';
import { AcceptedActionsRepository, ReflectionsRepository, SnapshotsRepository } from '../db/repositories';
import type { EngineEvent, HealthData, Reflection } from '../engine/types';
import { SyncStatus } from '../ingest/sync-status';
import { HEALTH_SOURCE, type HealthSource } from '../open-wearables/health.repository';
import { OpenWearablesError } from '../open-wearables/open-wearables.client';
import { StreamBus } from '../stream/stream.bus';
import {
  buildSnapshot,
  type ForecastSnapshot,
  isForecastSnapshot,
  liveDto,
  type MappingContext,
  mappingContext,
  toUserSummary,
} from './dto.mapper';
import { FORECAST_ENGINE, type ForecastEngine, type ForecastResult } from './engine.port';

/** Reads older than this trigger a background recompute (stale-while-revalidate). */
export const REFRESH_AFTER_MS = 60_000;
/** Snapshots older than this are reported as stale. */
export const STALE_AFTER_MS = 15 * 60_000;

export interface ComputedForecast {
  readonly userKey: UserKey;
  readonly computedAt: number;
  readonly profile: CalendarProfile;
  readonly events: readonly EngineEvent[];
  readonly reflections: readonly Reflection[];
  readonly health: HealthData;
  readonly result: ForecastResult;
  readonly ctx: MappingContext;
}

interface ServedSnapshot {
  readonly snapshot: ForecastSnapshot;
  readonly stale: boolean;
}

/** Seeded persona reflections first; reflections made in the app win for the same meeting. */
const mergeReflections = (seeded: readonly Reflection[], stored: readonly Reflection[]): Reflection[] => [
  ...new Map([...seeded, ...stored].map((reflection) => [reflection.meetingId, reflection])).values(),
];

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

@Injectable()
export class ForecastService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ForecastService.name);
  private readonly latest = new Map<UserKey, ComputedForecast>();
  private readonly running = new Map<UserKey, Promise<ComputedForecast>>();
  private readonly queued = new Map<UserKey, Promise<ComputedForecast>>();
  private readonly degraded = new Set<UserKey>();

  constructor(
    @Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider,
    @Inject(HEALTH_SOURCE) private readonly health: HealthSource,
    @Inject(FORECAST_ENGINE) private readonly engine: ForecastEngine,
    private readonly reflections: ReflectionsRepository,
    private readonly accepted: AcceptedActionsRepository,
    private readonly snapshots: SnapshotsRepository,
    private readonly bus: StreamBus,
    private readonly syncStatus: SyncStatus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async briefing(userKey: UserKey): Promise<BriefingDto> {
    const { snapshot, stale } = await this.snapshot(userKey);
    return { ...snapshot.briefing, stale };
  }

  async week(userKey: UserKey): Promise<WeekDto> {
    const { snapshot, stale } = await this.snapshot(userKey);
    return { ...snapshot.week, stale };
  }

  async energyMap(userKey: UserKey): Promise<EnergyMapDto> {
    return (await this.snapshot(userKey)).snapshot.energyMap;
  }

  /** The latest in-memory computation (engine result plus its inputs), computing it on first use. */
  async current(userKey: UserKey): Promise<ComputedForecast> {
    const latest = this.latest.get(userKey);
    if (latest === undefined) return this.recompute(userKey);
    this.refreshIfOlderThan(userKey, latest.computedAt);
    return latest;
  }

  /**
   * Recomputes and persists the forecast. Callers arriving while a run is in progress share one
   * trailing run, so changes they made just before calling (a reflection, an acceptance) are included.
   */
  recompute(userKey: UserKey): Promise<ComputedForecast> {
    const running = this.running.get(userKey);
    if (running === undefined) return this.start(userKey);
    const queued =
      this.queued.get(userKey) ??
      running.then(
        () => this.start(userKey),
        () => this.start(userKey),
      );
    this.queued.set(userKey, queued);
    return queued;
  }

  /** Resolves once no recompute is running or queued. */
  async idle(): Promise<void> {
    const pending = [...this.queued.values(), ...this.running.values()];
    if (pending.length === 0) return;
    await Promise.allSettled(pending);
    return this.idle();
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.idle();
  }

  private start(userKey: UserKey): Promise<ComputedForecast> {
    this.queued.delete(userKey);
    const run = this.compute(userKey).finally(() => this.running.delete(userKey));
    this.running.set(userKey, run);
    return run;
  }

  private async compute(userKey: UserKey): Promise<ComputedForecast> {
    const now = this.clock.now();
    const [profile, events, people, seeded, health] = await Promise.all([
      this.calendar.profile(userKey),
      this.calendar.events(userKey),
      this.calendar.people(userKey),
      this.calendar.seedReflections(userKey),
      this.loadHealth(userKey, now),
    ]);
    const reflections = mergeReflections(seeded, this.reflections.list(userKey));
    const accepted = this.accepted.list(userKey);
    const result = this.engine.buildForecast({ now, timeZone: profile.timeZone, events, people, health, reflections, accepted });
    const ctx = mappingContext(profile.timeZone, people);
    const user = toUserSummary(profile);
    const live = user.live ? liveDto(health, now, this.syncStatus.lastSyncAt(userKey), ctx) : null;
    const snapshot = buildSnapshot(result, { user, accepted, live, ctx });
    this.snapshots.save(userKey, now, snapshot);
    const computed: ComputedForecast = { userKey, computedAt: now, profile, events, reflections, health, result, ctx };
    this.latest.set(userKey, computed);
    this.bus.publish(userKey, { type: 'forecast.updated', computedAt: snapshot.briefing.computedAt });
    return computed;
  }

  /** Falls back to the last known health data while open-wearables is unreachable (and flags the user stale). */
  private loadHealth(userKey: UserKey, now: number): Promise<HealthData> {
    return this.health.load(userKey, now).then(
      (health) => {
        this.degraded.delete(userKey);
        return health;
      },
      (error: unknown) => {
        if (!(error instanceof OpenWearablesError)) throw error;
        this.degraded.add(userKey);
        const previous = this.latest.get(userKey);
        this.logger.warn(
          `open-wearables failed for ${userKey}: ${error.message}; ${previous ? 'using the last known health data' : 'nothing to fall back on'}`,
        );
        if (previous) return previous.health;
        throw unavailable(
          'open-wearables-unavailable',
          'open-wearables unavailable',
          'Health data could not be loaded from open-wearables. Check that it is running and try again.',
        );
      },
    );
  }

  private async snapshot(userKey: UserKey): Promise<ServedSnapshot> {
    const stored = this.storedSnapshot(userKey) ?? (await this.recompute(userKey).then(() => this.storedSnapshot(userKey)));
    if (stored === null) throw new Error(`No forecast snapshot for ${userKey} after recomputing`);
    this.refreshIfOlderThan(userKey, stored.computedAt);
    const stale = this.degraded.has(userKey) || this.clock.now() - stored.computedAt > STALE_AFTER_MS;
    return { snapshot: stored.snapshot, stale };
  }

  private storedSnapshot(userKey: UserKey): { readonly computedAt: number; readonly snapshot: ForecastSnapshot } | null {
    const stored = this.snapshots.latest(userKey);
    return stored !== null && isForecastSnapshot(stored.payload) ? { computedAt: stored.computedAt, snapshot: stored.payload } : null;
  }

  private refreshIfOlderThan(userKey: UserKey, computedAt: number): void {
    if (this.clock.now() - computedAt <= REFRESH_AFTER_MS || this.running.has(userKey)) return;
    this.recompute(userKey).catch((error: unknown) =>
      this.logger.warn(`Background refresh for ${userKey} failed: ${describeError(error)}`),
    );
  }
}
