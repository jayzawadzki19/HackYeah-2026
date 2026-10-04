import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StreamEventDto } from '../../../contracts/api-contract';
import { calendarFixture } from '../../test/support/calendar-fixture';
import { at, SLEEP_ACTION } from '../../test/support/forecast-fixture';
import { deferred, FakeCalendar, FakeClock, FakeEngine, FakeHealthSource } from '../../test/support/fakes';
import { ProblemException } from '../common/problem';
import { type AppDatabase, openDatabase } from '../db/database';
import { AcceptedActionsRepository, ReflectionsRepository, SnapshotsRepository } from '../db/repositories';
import { SyncStatus } from '../ingest/sync-status';
import { OpenWearablesError } from '../open-wearables/open-wearables.client';
import { StreamBus } from '../stream/stream.bus';
import { ForecastService } from './forecast.service';

const T0 = at('2026-10-04T11:00:00+02:00');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const owDown = () => new OpenWearablesError('network', 'open-wearables is unreachable (connection refused)');

describe('ForecastService', () => {
  let database: AppDatabase;
  let clock: FakeClock;
  let calendar: FakeCalendar;
  let health: FakeHealthSource;
  let engine: FakeEngine;
  let bus: StreamBus;
  let syncStatus: SyncStatus;
  let reflections: ReflectionsRepository;
  let accepted: AcceptedActionsRepository;
  let snapshots: SnapshotsRepository;
  let service: ForecastService;

  beforeEach(() => {
    database = openDatabase(':memory:');
    clock = new FakeClock(T0);
    calendar = new FakeCalendar({
      jakub: calendarFixture(),
      marta: calendarFixture({ userKey: 'marta', displayName: 'Marta', isSynthetic: true }),
    });
    health = new FakeHealthSource();
    engine = new FakeEngine();
    bus = new StreamBus();
    syncStatus = new SyncStatus();
    reflections = new ReflectionsRepository(database);
    accepted = new AcceptedActionsRepository(database);
    snapshots = new SnapshotsRepository(database);
    service = new ForecastService(calendar, health, engine, reflections, accepted, snapshots, bus, syncStatus, clock);
  });

  afterEach(async () => {
    await service.idle();
    database.close();
  });

  test('computes on first read, persists the snapshot and reports it fresh', async () => {
    const briefing = await service.briefing('marta');

    expect(briefing).toMatchObject({ computedAt: '2026-10-04T11:00:00+02:00', stale: false, user: { key: 'marta', live: false } });
    expect(snapshots.latest('marta')?.computedAt).toBe(T0);
    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]).toMatchObject({ now: T0, timeZone: 'Europe/Warsaw', accepted: [] });
    expect(engine.inputs[0]?.people.map((person) => person.id)).toEqual(['p-mentor', 'p-team']);
  });

  test('gives the engine seeded reflections overridden by stored ones, and accepted changes', async () => {
    reflections.upsert('jakub', 'm-rehearsal', 1, T0 - MINUTE);
    reflections.upsert('jakub', 'm-jury', 0, T0 - MINUTE);
    accepted.accept('jakub', SLEEP_ACTION.id, SLEEP_ACTION.change, T0 - MINUTE);

    await service.recompute('jakub');

    expect(engine.inputs[0]?.reflections).toEqual([
      { meetingId: 'm-rehearsal', rating: 1 },
      { meetingId: 'm-jury', rating: 0 },
    ]);
    expect(engine.inputs[0]?.accepted).toEqual([{ actionId: SLEEP_ACTION.id, change: SLEEP_ACTION.change }]);
  });

  test('serves a fresh snapshot without recomputing', async () => {
    await service.briefing('marta');
    clock.advance(30 * SECOND);

    await service.week('marta');
    await service.energyMap('marta');
    await service.idle();

    expect(engine.inputs).toHaveLength(1);
  });

  test('serves an older snapshot immediately and refreshes it once in the background', async () => {
    await service.briefing('marta');
    clock.advance(2 * MINUTE);

    const [first, second] = await Promise.all([service.briefing('marta'), service.week('marta')]);
    await service.idle();

    expect(first.computedAt).toBe('2026-10-04T11:00:00+02:00');
    expect(second.computedAt).toBe('2026-10-04T11:00:00+02:00');
    expect(engine.inputs).toHaveLength(2);
    expect((await service.briefing('marta')).computedAt).toBe('2026-10-04T11:02:00+02:00');
  });

  test('marks a snapshot older than 15 minutes as stale', async () => {
    await service.briefing('marta');
    clock.advance(16 * MINUTE);

    expect((await service.briefing('marta')).stale).toBe(true);
  });

  test('ignores a snapshot written by an older version and recomputes', async () => {
    snapshots.save('marta', T0, { version: 0, briefing: {} });

    expect((await service.briefing('marta')).headline).toBe('Tomorrow is your heaviest day in 6 weeks.');
    expect(engine.inputs).toHaveLength(1);
  });

  test('answers 503 when open-wearables is down and nothing was computed yet', async () => {
    health.failure = owDown();

    const error = await service.briefing('marta').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 503, type: '/problems/open-wearables-unavailable' });
    expect(engine.inputs).toHaveLength(0);
  });

  test('keeps working on the last known health while open-wearables is down, flagged stale until it recovers', async () => {
    await service.recompute('marta');
    health.failure = owDown();
    clock.advance(MINUTE);

    await service.recompute('marta');
    const degraded = await service.briefing('marta');
    health.failure = null;
    await service.recompute('marta');
    const recovered = await service.briefing('marta');

    expect(degraded).toMatchObject({ computedAt: '2026-10-04T11:01:00+02:00', stale: true });
    expect(recovered.stale).toBe(false);
  });

  test('does not swallow unexpected errors', async () => {
    health.failure = new TypeError('bug');

    await expect(service.recompute('marta')).rejects.toThrow('bug');
  });

  test('shares a running recompute and coalesces later requests into one trailing run', async () => {
    const gate = deferred<void>();
    health.gate = gate;

    const first = service.recompute('marta');
    const second = service.recompute('marta');
    const third = service.recompute('marta');
    gate.resolve();
    const results = await Promise.all([first, second, third]);

    expect(engine.inputs).toHaveLength(2);
    expect(results[1]).toBe(results[2]);
    expect(results[0]).not.toBe(results[1]);
  });

  test('publishes forecast.updated for the user', async () => {
    const events: StreamEventDto[] = [];
    const subscription = bus.events('marta').subscribe((event) => events.push(event));

    await service.recompute('marta');
    subscription.unsubscribe();

    expect(events).toEqual([{ type: 'forecast.updated', computedAt: '2026-10-04T11:00:00+02:00' }]);
  });

  test('includes live data for live users only', async () => {
    syncStatus.markSynced('jakub', T0 - MINUTE);
    health.data = { ...health.data, stress: [{ t: T0 - 2 * MINUTE, v: 31 }] };

    const jakub = await service.briefing('jakub');
    const marta = await service.briefing('marta');

    expect(jakub.live).toEqual({
      lastSampleAt: '2026-10-04T10:58:00+02:00',
      lastSyncAt: '2026-10-04T10:59:00+02:00',
      points: [{ t: '2026-10-04T10:58:00+02:00', stress: 31, heartRate: null }],
    });
    expect(marta.live).toBeNull();
  });

  test('keeps the latest computation in memory for detail views', async () => {
    const computed = await service.current('marta');

    expect(computed).toMatchObject({ userKey: 'marta', computedAt: T0, profile: { timeZone: 'Europe/Warsaw' } });
    expect(await service.current('marta')).toBe(computed);
    expect(engine.inputs).toHaveLength(1);
  });
});
