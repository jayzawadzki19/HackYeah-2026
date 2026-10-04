import { describe, expect, test } from 'bun:test';
import { TEST_OW_USER_IDS } from '../../test/support/test-config';
import { HealthRepository } from './health.repository';
import type { OpenWearablesReader, SeriesType, SleepSessionRecord, TimeSeriesSample } from './open-wearables.client';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-04T09:00:00Z');

const sample = (t: number, type: SeriesType, value: number, isDailyTotal: boolean | null = null): TimeSeriesSample => ({
  timestamp: new Date(t).toISOString(),
  type,
  value,
  is_daily_total: isDailyTotal,
});

const sleep = (id: string, start: number, end: number, extra: Partial<SleepSessionRecord> = {}): SleepSessionRecord => ({
  id,
  start_time: new Date(start).toISOString(),
  end_time: new Date(end).toISOString(),
  duration_seconds: (end - start) / 1000,
  is_nap: false,
  ...extra,
});

interface Call {
  readonly method: 'timeseries' | 'sleepSessions' | 'resilienceScore';
  readonly userId: string;
  readonly start?: number;
  readonly end?: number;
  readonly types?: readonly SeriesType[];
  readonly date?: string;
}

const fakeReader = (data: {
  samples?: readonly TimeSeriesSample[];
  sleeps?: readonly SleepSessionRecord[];
  resilience?: number | null;
  fail?: () => boolean;
}) => {
  const calls: Call[] = [];
  const state = { ...data };
  const guard = () => {
    if (state.fail?.()) throw new Error('open-wearables down');
  };
  const reader: OpenWearablesReader = {
    timeseries: async (userId, types, start, end) => {
      calls.push({ method: 'timeseries', userId, types, start, end });
      guard();
      return (state.samples ?? []).filter((s) => Date.parse(s.timestamp) >= start && Date.parse(s.timestamp) <= end);
    },
    sleepSessions: async (userId, start, end) => {
      calls.push({ method: 'sleepSessions', userId, start, end });
      guard();
      return (state.sleeps ?? []).filter((s) => Date.parse(s.start_time) >= start && Date.parse(s.start_time) <= end);
    },
    workouts: async () => [],
    resilienceScore: async (userId, date) => {
      calls.push({ method: 'resilienceScore', userId, date });
      guard();
      return state.resilience ?? null;
    },
  };
  return { reader, calls, state };
};

describe('HealthRepository', () => {
  test('maps open-wearables series into engine health data', async () => {
    const { reader } = fakeReader({
      samples: [
        sample(NOW - 2 * HOUR, 'garmin_stress_level', 30),
        sample(NOW - 3 * HOUR, 'garmin_stress_level', 25),
        sample(NOW - 2 * HOUR, 'garmin_stress_level', -1),
        sample(NOW - 2 * HOUR, 'heart_rate', 64),
        sample(NOW - 2 * HOUR, 'steps', 120, false),
        sample(NOW - 2 * HOUR + 1, 'steps', 9_000, true),
        sample(NOW - 2 * HOUR, 'garmin_body_battery', 41),
        sample(NOW - 6 * HOUR, 'heart_rate_variability_rmssd', 52),
      ],
      resilience: 75,
    });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);

    const health = await repository.load('marta', NOW);

    expect(health.stress).toEqual([
      { t: NOW - 3 * HOUR, v: 25 },
      { t: NOW - 2 * HOUR, v: 30 },
    ]);
    expect(health.heartRate).toEqual([{ t: NOW - 2 * HOUR, v: 64 }]);
    expect(health.steps).toEqual([{ t: NOW - 2 * HOUR, v: 120 }]);
    expect(health.bodyBattery).toEqual([{ t: NOW - 2 * HOUR, v: 41 }]);
    expect(health.hrv).toEqual([{ t: NOW - 6 * HOUR, v: 52 }]);
    expect(health.resilienceScore).toBe(75);
  });

  test('maps main sleep sessions with the best available asleep duration and skips naps', async () => {
    const night = (daysAgo: number) => NOW - daysAgo * DAY - 9 * HOUR;
    const { reader } = fakeReader({
      sleeps: [
        sleep('s1', night(1), night(1) + 8 * HOUR, { sleep_duration_seconds: 7 * 3_600 }),
        sleep('s2', night(2), night(2) + 8 * HOUR, {
          stages: { awake_minutes: 30, light_minutes: 200, deep_minutes: 100, rem_minutes: 90 },
        }),
        sleep('s3', night(3), night(3) + 6 * HOUR),
        sleep('nap', NOW - 4 * HOUR, NOW - 3 * HOUR, { is_nap: true }),
      ],
    });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);

    const { sleeps } = await repository.load('marta', NOW);

    expect(sleeps).toEqual([
      { start: night(3), end: night(3) + 6 * HOUR, asleepMin: 360 },
      { start: night(2), end: night(2) + 8 * HOUR, asleepMin: 390 },
      { start: night(1), end: night(1) + 8 * HOUR, asleepMin: 420 },
    ]);
  });

  test('reads the user mapped to the key, over the 43-day window, with the UTC date for resilience', async () => {
    const { reader, calls } = fakeReader({});
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);

    await repository.load('jakub', NOW);

    expect(calls.find((c) => c.method === 'timeseries')).toMatchObject({
      userId: TEST_OW_USER_IDS.jakub,
      start: NOW - 43 * DAY,
      end: NOW,
      types: ['garmin_stress_level', 'heart_rate', 'steps', 'garmin_body_battery', 'heart_rate_variability_rmssd'],
    });
    expect(calls.find((c) => c.method === 'resilienceScore')).toMatchObject({ date: '2026-10-04' });
  });

  test('fetches only from two hours before the newest cached sample on the next load', async () => {
    const { reader, calls, state } = fakeReader({ samples: [sample(NOW - HOUR, 'heart_rate', 60)] });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);
    await repository.load('marta', NOW);
    state.samples = [sample(NOW - HOUR, 'heart_rate', 61), sample(NOW + 10 * 60_000, 'heart_rate', 70)];
    calls.length = 0;

    const health = await repository.load('marta', NOW + 15 * 60_000);

    expect(calls.find((c) => c.method === 'timeseries')).toMatchObject({ start: NOW - 3 * HOUR, end: NOW + 15 * 60_000 });
    expect(health.heartRate).toEqual([
      { t: NOW - HOUR, v: 61 },
      { t: NOW + 10 * 60_000, v: 70 },
    ]);
  });

  test('drops cached samples once they leave the window', async () => {
    const old = NOW - 43 * DAY + HOUR;
    const { reader, state } = fakeReader({ samples: [sample(old, 'heart_rate', 55), sample(NOW, 'heart_rate', 65)] });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);
    await repository.load('marta', NOW);
    state.samples = [];

    const health = await repository.load('marta', NOW + 2 * HOUR);

    expect(health.heartRate).toEqual([{ t: NOW, v: 65 }]);
  });

  test('keeps the previous cache when a fetch fails', async () => {
    let down = false;
    const { reader, calls } = fakeReader({ samples: [sample(NOW - HOUR, 'heart_rate', 60)], fail: () => down });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);
    await repository.load('marta', NOW);
    down = true;

    await expect(repository.load('marta', NOW + HOUR)).rejects.toThrow('open-wearables down');
    down = false;
    calls.length = 0;
    const health = await repository.load('marta', NOW + 2 * HOUR);

    expect(calls.find((c) => c.method === 'timeseries')).toMatchObject({ start: NOW - 3 * HOUR });
    expect(health.heartRate).toEqual([{ t: NOW - HOUR, v: 60 }]);
  });

  test('handles six weeks of per-minute samples', async () => {
    const minutes = 42 * 24 * 60;
    const samples = Array.from({ length: minutes * 3 }, (_, i) =>
      sample(NOW - (i % minutes) * 60_000, i < minutes ? 'garmin_stress_level' : i < 2 * minutes ? 'heart_rate' : 'steps', 20),
    );
    const { reader, calls } = fakeReader({ samples });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);
    await repository.load('marta', NOW);
    calls.length = 0;

    const health = await repository.load('marta', NOW + 60_000);

    expect(health.stress).toHaveLength(minutes);
    expect(calls.find((c) => c.method === 'timeseries')).toMatchObject({ start: NOW - 2 * HOUR });
  });

  test('keeps a separate cache per user', async () => {
    const { reader, calls } = fakeReader({ samples: [sample(NOW - HOUR, 'heart_rate', 60)] });
    const repository = new HealthRepository(reader, TEST_OW_USER_IDS);
    await repository.load('marta', NOW);
    calls.length = 0;

    await repository.load('jakub', NOW);

    expect(calls.find((c) => c.method === 'timeseries')).toMatchObject({ start: NOW - 43 * DAY });
  });
});
