import type { UserKey } from '../../../contracts/api-contract';
import type { HealthData, Sample, SleepSession } from '../engine/types';
import type { OpenWearablesReader, SeriesType, SleepSessionRecord, TimeSeriesSample } from './open-wearables.client';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** HISTORY_DAYS (42) plus one day so the first history day is complete. */
export const HEALTH_LOOKBACK_MS = 43 * DAY_MS;
/** Re-read this much before the newest cached sample, to pick up late-arriving data. */
export const SAMPLE_OVERLAP_MS = 2 * HOUR_MS;
/** Sleep sessions are saved when they end, up to a night after they start. */
const SLEEP_OVERLAP_MS = 48 * HOUR_MS;

type SeriesField = 'stress' | 'heartRate' | 'steps' | 'bodyBattery' | 'hrv';

const SERIES: Readonly<Record<SeriesField, SeriesType>> = {
  stress: 'garmin_stress_level',
  heartRate: 'heart_rate',
  steps: 'steps',
  bodyBattery: 'garmin_body_battery',
  hrv: 'heart_rate_variability_rmssd',
};

const FIELDS: readonly SeriesField[] = ['stress', 'heartRate', 'steps', 'bodyBattery', 'hrv'];
const FIELD_BY_TYPE: ReadonlyMap<string, SeriesField> = new Map(FIELDS.map((field) => [SERIES[field], field]));

const perField = <T>(build: (field: SeriesField) => T): Readonly<Record<SeriesField, T>> => ({
  stress: build('stress'),
  heartRate: build('heartRate'),
  steps: build('steps'),
  bodyBattery: build('bodyBattery'),
  hrv: build('hrv'),
});

type SeriesMaps = Readonly<Record<SeriesField, ReadonlyMap<number, number>>>;

interface UserHealthCache {
  readonly series: SeriesMaps;
  readonly sleeps: ReadonlyMap<string, SleepSession>;
}

const EMPTY_CACHE: UserHealthCache = { series: perField(() => new Map()), sleeps: new Map() };

/** Garmin flags unmeasurable stress with negative values; daily step totals would break 15-min buckets. */
const isUsable = (field: SeriesField, sample: TimeSeriesSample): boolean =>
  !(field === 'stress' && sample.value < 0) && !(field === 'steps' && sample.is_daily_total === true);

const mergeSeries = (series: SeriesMaps, incoming: readonly TimeSeriesSample[], windowStart: number): SeriesMaps =>
  perField((field) => {
    const fresh = incoming
      .filter((sample) => FIELD_BY_TYPE.get(sample.type) === field && isUsable(field, sample))
      .map((sample) => [Date.parse(sample.timestamp), sample.value] as const)
      .filter(([t]) => Number.isFinite(t));
    return new Map([...series[field], ...fresh].filter(([t]) => t >= windowStart));
  });

const stageMinutes = (record: SleepSessionRecord): number | null => {
  const stages = record.stages;
  const parts = [stages?.light_minutes, stages?.deep_minutes, stages?.rem_minutes].filter(
    (minutes): minutes is number => typeof minutes === 'number',
  );
  return parts.length > 0 ? parts.reduce((sum, minutes) => sum + minutes, 0) : null;
};

export const toSleepSession = (record: SleepSessionRecord): SleepSession => {
  const start = Date.parse(record.start_time);
  const end = Date.parse(record.end_time);
  const asleepMin =
    typeof record.sleep_duration_seconds === 'number'
      ? record.sleep_duration_seconds / 60
      : (stageMinutes(record) ?? (end - start) / 60_000);
  return { start, end, asleepMin };
};

const mergeSleeps = (
  sleeps: ReadonlyMap<string, SleepSession>,
  incoming: readonly SleepSessionRecord[],
  windowStart: number,
): ReadonlyMap<string, SleepSession> =>
  new Map(
    [...sleeps, ...incoming.filter((record) => !record.is_nap).map((record) => [record.id, toSleepSession(record)] as const)].filter(
      ([, session]) => session.end >= windowStart,
    ),
  );

const newestSampleAt = (cache: UserHealthCache): number | null => {
  const times = FIELDS.flatMap((field) => [...cache.series[field].keys()]);
  return times.length > 0 ? Math.max(...times) : null;
};

const toSamples = (series: ReadonlyMap<number, number>): readonly Sample[] =>
  [...series].map(([t, v]) => ({ t, v })).toSorted((a, b) => a.t - b.t);

const toHealthData = (cache: UserHealthCache, resilienceScore: number | null): HealthData => ({
  stress: toSamples(cache.series.stress),
  heartRate: toSamples(cache.series.heartRate),
  steps: toSamples(cache.series.steps),
  bodyBattery: toSamples(cache.series.bodyBattery),
  hrv: toSamples(cache.series.hrv),
  sleeps: [...cache.sleeps.values()].toSorted((a, b) => a.start - b.start),
  resilienceScore,
});

export interface HealthSource {
  load(userKey: UserKey, now: number): Promise<HealthData>;
}

export const HEALTH_SOURCE = Symbol('HealthSource');

/** Loads engine health data from open-wearables, fetching only what is new since the previous load. */
export class HealthRepository implements HealthSource {
  private readonly cache = new Map<UserKey, UserHealthCache>();

  constructor(
    private readonly reader: OpenWearablesReader,
    private readonly owUserIds: Readonly<Record<UserKey, string>>,
  ) {}

  async load(userKey: UserKey, now: number): Promise<HealthData> {
    const userId = this.owUserIds[userKey];
    const windowStart = now - HEALTH_LOOKBACK_MS;
    const cached = this.cache.get(userKey) ?? EMPTY_CACHE;
    const since = Math.max(windowStart, (newestSampleAt(cached) ?? windowStart) - SAMPLE_OVERLAP_MS);
    const [samples, sleeps, resilience] = await Promise.all([
      this.reader.timeseries(userId, FIELDS.map((field) => SERIES[field]), since, now),
      this.reader.sleepSessions(userId, Math.max(windowStart, since - SLEEP_OVERLAP_MS), now),
      this.reader.resilienceScore(userId, new Date(now).toISOString().slice(0, 10)),
    ]);
    const next: UserHealthCache = {
      series: mergeSeries(cached.series, samples, windowStart),
      sleeps: mergeSleeps(cached.sleeps, sleeps, windowStart),
    };
    this.cache.set(userKey, next);
    return toHealthData(next, resilience);
  }
}
