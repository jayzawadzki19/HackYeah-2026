import { calendarFixture } from './calendar-fixture';
import { at } from './forecast-fixture';
import { FakeCalendar, FakeClock, FakeEngine, FakeHealthSource } from './fakes';
import type { AppDatabase } from '../../src/db/database';
import { openDatabase } from '../../src/db/database';
import { AcceptedActionsRepository, ReflectionsRepository, SnapshotsRepository, WebhookDeliveriesRepository } from '../../src/db/repositories';
import { ForecastService } from '../../src/forecast/forecast.service';
import { SyncStatus } from '../../src/ingest/sync-status';
import { StreamBus } from '../../src/stream/stream.bus';

const T0 = at('2026-10-04T11:00:00+02:00');

export const forecastStack = () => {
  const database: AppDatabase = openDatabase(':memory:');
  const clock = new FakeClock(T0);
  const calendar = new FakeCalendar({
    jakub: calendarFixture(),
    marta: calendarFixture({ userKey: 'marta', displayName: 'Marta', isSynthetic: true }),
  });
  const health = new FakeHealthSource();
  const engine = new FakeEngine();
  const bus = new StreamBus();
  const syncStatus = new SyncStatus();
  const reflections = new ReflectionsRepository(database);
  const accepted = new AcceptedActionsRepository(database);
  const snapshots = new SnapshotsRepository(database);
  const deliveries = new WebhookDeliveriesRepository(database);
  const forecasts = new ForecastService(calendar, health, engine, reflections, accepted, snapshots, bus, syncStatus, clock);
  return {
    database,
    clock,
    calendar,
    health,
    engine,
    bus,
    syncStatus,
    reflections,
    accepted,
    snapshots,
    deliveries,
    forecasts,
    async close(): Promise<void> {
      await forecasts.idle();
      database.close();
    },
  };
};

export type ForecastStack = ReturnType<typeof forecastStack>;
