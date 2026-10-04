import { describe, expect, test } from 'bun:test';
import { fakeFetch, hang, json, type FakeHandler } from '../../test/support/fake-fetch';
import { OpenWearablesClient, OpenWearablesError } from './open-wearables.client';

const USER = '11111111-1111-4111-8111-111111111111';
const START = Date.parse('2026-10-01T00:00:00Z');
const END = Date.parse('2026-10-02T00:00:00Z');

const sample = (timestamp: string, type: string, value: number) => ({
  timestamp,
  type,
  value,
  unit: 'unit',
  zone_offset: '+02:00',
  source: null,
  is_daily_total: null,
});

const page = <T>(data: readonly T[], nextCursor: string | null = null) => ({
  data,
  pagination: { has_more: nextCursor !== null, next_cursor: nextCursor },
  metadata: {},
});

const setup = (handler: FakeHandler, timeoutMs = 5_000) => {
  const fake = fakeFetch(handler);
  const delays: number[] = [];
  const client = new OpenWearablesClient({
    baseUrl: 'http://ow.test',
    apiKey: 'sk-test-key',
    fetch: fake.fetch,
    timeoutMs,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { client, calls: fake.calls, delays };
};

describe('OpenWearablesClient.timeseries', () => {
  test('sends the API key and the raw-resolution query for every requested type', async () => {
    const { client, calls } = setup(() => json(page([sample('2026-10-01T08:00:00+02:00', 'heart_rate', 61)])));

    const samples = await client.timeseries(USER, ['heart_rate', 'garmin_stress_level'], START, END);

    expect(samples).toEqual([{ timestamp: '2026-10-01T08:00:00+02:00', type: 'heart_rate', value: 61, is_daily_total: null }]);
    const [call] = calls;
    expect(call?.headers.get('X-Open-Wearables-API-Key')).toBe('sk-test-key');
    expect(call?.url.pathname).toBe(`/api/v1/users/${USER}/timeseries`);
    expect(call?.url.searchParams.getAll('types')).toEqual(['heart_rate', 'garmin_stress_level']);
    expect(call?.url.searchParams.get('start_time')).toBe('2026-10-01T00:00:00.000Z');
    expect(call?.url.searchParams.get('end_time')).toBe('2026-10-02T00:00:00.000Z');
    expect(call?.url.searchParams.get('resolution')).toBe('raw');
    expect(call?.url.searchParams.get('limit')).toBe('1000');
    expect(call?.url.searchParams.has('cursor')).toBe(false);
  });

  test('follows the cursor until the last page', async () => {
    const { client, calls } = setup((request) =>
      request.url.searchParams.get('cursor') === 'c1'
        ? json(page([sample('2026-10-01T08:02:00Z', 'heart_rate', 62)]))
        : json(page([sample('2026-10-01T08:00:00Z', 'heart_rate', 61)], 'c1')),
    );

    const samples = await client.timeseries(USER, ['heart_rate'], START, END);

    expect(samples.map((s) => s.value)).toEqual([61, 62]);
    expect(calls.map((call) => call.url.searchParams.get('cursor'))).toEqual([null, 'c1']);
  });

  test('stops with an error when the server repeats a cursor', async () => {
    const { client } = setup(() => json(page([sample('2026-10-01T08:00:00Z', 'heart_rate', 61)], 'same')));

    await expect(client.timeseries(USER, ['heart_rate'], START, END)).rejects.toThrow(/cursor/);
  });

  test('retries server errors with exponential backoff, then succeeds', async () => {
    const { client, calls, delays } = setup((_, index) => (index < 2 ? json({ detail: 'boom' }, 503) : json(page([]))));

    expect(await client.timeseries(USER, ['heart_rate'], START, END)).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([250, 500]);
  });

  test('gives up after three retries', async () => {
    const { client, calls } = setup(() => json({ detail: 'down' }, 502));

    const error = await client.timeseries(USER, ['heart_rate'], START, END).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenWearablesError);
    expect(error).toMatchObject({ kind: 'http', status: 502 });
    expect(calls).toHaveLength(4);
  });

  test('does not retry client errors', async () => {
    const { client, calls } = setup(() => json({ detail: 'Invalid or missing API key' }, 401));

    const error = await client.timeseries(USER, ['heart_rate'], START, END).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'http', status: 401 });
    expect(String(error)).toContain('Invalid or missing API key');
    expect(calls).toHaveLength(1);
  });

  test('retries network failures', async () => {
    const { client, calls } = setup((_, index) => {
      if (index === 0) throw new TypeError('fetch failed');
      return json(page([]));
    });

    expect(await client.timeseries(USER, ['heart_rate'], START, END)).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  test('aborts requests that exceed the timeout and reports a timeout after the retries', async () => {
    const { client, calls } = setup(hang, 10);

    const error = await client.timeseries(USER, ['heart_rate'], START, END).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'timeout' });
    expect(calls).toHaveLength(4);
  });

  test('rejects a response that does not match the open-wearables schema', async () => {
    const { client, calls } = setup(() => json({ data: [{ timestamp: 5 }], pagination: { has_more: false } }));

    const error = await client.timeseries(USER, ['heart_rate'], START, END).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'invalid_response' });
    expect(calls).toHaveLength(1);
  });
});

describe('OpenWearablesClient events', () => {
  const sleep = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    start_time: '2026-10-01T23:00:00+02:00',
    end_time: '2026-10-02T06:30:00+02:00',
    duration_seconds: 27_000,
    sleep_duration_seconds: 25_200,
    stages: { awake_minutes: 30, light_minutes: 200, deep_minutes: 120, rem_minutes: 100 },
    is_nap: false,
    source: { provider: 'apple' },
  };

  test('reads sleep sessions with start_date/end_date and pagination', async () => {
    const { client, calls } = setup((request) =>
      request.url.searchParams.get('cursor') === 'n' ? json(page([{ ...sleep, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])) : json(page([sleep], 'n')),
    );

    const sessions = await client.sleepSessions(USER, START, END);

    expect(sessions.map((s) => s.id)).toEqual([sleep.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    expect(sessions[0]).toMatchObject({ sleep_duration_seconds: 25_200, is_nap: false });
    expect(calls[0]?.url.pathname).toBe(`/api/v1/users/${USER}/events/sleep`);
    expect(calls[0]?.url.searchParams.get('start_date')).toBe('2026-10-01T00:00:00.000Z');
    expect(calls[0]?.url.searchParams.get('end_date')).toBe('2026-10-02T00:00:00.000Z');
  });

  test('reads workouts', async () => {
    const workout = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      type: 'running',
      name: 'Intervals',
      start_time: '2026-10-01T18:30:00+02:00',
      end_time: '2026-10-01T19:30:00+02:00',
      source: { provider: 'apple' },
    };
    const { client, calls } = setup(() => json(page([workout])));

    const workouts = await client.workouts(USER, START, END);

    expect(workouts).toEqual([
      { id: workout.id, type: 'running', name: 'Intervals', start_time: workout.start_time, end_time: workout.end_time },
    ]);
    expect(calls[0]?.url.pathname).toBe(`/api/v1/users/${USER}/events/workouts`);
  });
});

describe('OpenWearablesClient.resilienceScore', () => {
  const score = (recorded_at: string, value: number | null) => ({
    id: crypto.randomUUID(),
    category: 'resilience',
    value,
    recorded_at,
    data_source_id: null,
    provider: null,
  });

  test('returns the latest resilience value up to the date', async () => {
    const { client, calls } = setup(() =>
      json({
        data: [score('2026-10-03T00:00:00Z', 70), score('2026-10-04T00:00:00Z', 75), score('2026-10-02T00:00:00Z', 60)],
        pagination: { has_more: false },
        metadata: {},
      }),
    );

    expect(await client.resilienceScore(USER, '2026-10-04')).toBe(75);
    expect(calls[0]?.url.pathname).toBe(`/api/v1/users/${USER}/health-scores`);
    expect(calls[0]?.url.searchParams.get('category')).toBe('resilience');
    expect(calls[0]?.url.searchParams.get('start_date')).toBe('2026-09-27');
    expect(calls[0]?.url.searchParams.get('end_date')).toBe('2026-10-04');
  });

  test('returns null when no resilience value exists', async () => {
    const { client } = setup(() =>
      json({ data: [score('2026-10-04T00:00:00Z', null)], pagination: { has_more: false }, metadata: {} }),
    );

    expect(await client.resilienceScore(USER, '2026-10-04')).toBeNull();
  });
});
