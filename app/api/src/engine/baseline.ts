import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { median, sum } from './math';
import { ensureSorted, intervalTester, lowerBound } from './series';
import { DAY_MS, localHour } from './time';
import type { EpochMs, Interval, Sample } from './types';

/** Step sums per 15-minute bucket, keyed by bucket start (epoch-aligned, so local quarter-hours too). */
export type StepBuckets = ReadonlyMap<EpochMs, number>;

/** Personal sedentary baseline per local hour (index 0-23); null where there is not enough data. */
export interface Baseline {
  readonly stressByHour: readonly (number | null)[];
  readonly hrByHour: readonly (number | null)[];
}

export interface BaselineInput {
  readonly stress: readonly Sample[];
  readonly heartRate: readonly Sample[];
  readonly steps: readonly Sample[];
  /** meetings, workouts and sleep: samples inside them never count */
  readonly exclusions: readonly Interval[];
  readonly now: EpochMs;
  readonly timeZone: string;
}

const BUCKET_MS = 15 * 60_000;
const MIN_SAMPLES_PER_HOUR = 10;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export const bucketStart = (t: EpochMs): EpochMs => Math.floor(t / BUCKET_MS) * BUCKET_MS;

const bucketCache = new WeakMap<readonly Sample[], StepBuckets>();

/** Memoised per steps array, so per-meeting callers do not re-bucket the whole series. */
export const sedentaryBuckets = (steps: readonly Sample[]): StepBuckets => {
  const cached = bucketCache.get(steps);
  if (cached) return cached;
  const buckets = steps.reduce(
    (acc, s) => acc.set(bucketStart(s.t), (acc.get(bucketStart(s.t)) ?? 0) + s.v),
    new Map<EpochMs, number>(),
  );
  bucketCache.set(steps, buckets);
  return buckets;
};

/** A bucket without step records counts as 0 steps, i.e. sedentary. */
export const isSedentary = (t: EpochMs, buckets: StepBuckets, cfg: EngineConfig = ENGINE_CONFIG): boolean =>
  (buckets.get(bucketStart(t)) ?? 0) <= cfg.SEDENTARY_MAX_STEPS_PER_15MIN;

const circularDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
};

const valuesByHour = (samples: readonly Sample[], keep: (t: EpochMs) => boolean, timeZone: string): number[][] =>
  samples.reduce(
    (byHour, s) => {
      if (keep(s.t)) byHour[localHour(s.t, timeZone)]!.push(s.v);
      return byHour;
    },
    HOURS.map((): number[] => []),
  );

/** Median per hour; an hour with too few samples pools the nearest hours until there are enough. */
const hourMedians = (byHour: readonly (readonly number[])[]): (number | null)[] => {
  const counts = byHour.map((values) => values.length);
  const radiusFor = (hour: number): number | undefined =>
    HOURS.slice(0, 13).find(
      (radius) => sum(counts.filter((_, h) => circularDistance(h, hour) <= radius)) >= MIN_SAMPLES_PER_HOUR,
    );
  return HOURS.map((hour) => {
    const radius = radiusFor(hour);
    return radius === undefined
      ? null
      : median(byHour.flatMap((values, h) => (circularDistance(h, hour) <= radius ? values : [])));
  });
};

export const buildBaseline = (input: BaselineInput, cfg: EngineConfig = ENGINE_CONFIG): Baseline => {
  const from = input.now - cfg.BASELINE_LOOKBACK_DAYS * DAY_MS;
  const buckets = sedentaryBuckets(input.steps);
  const excluded = intervalTester(input.exclusions);
  const keep = (t: EpochMs): boolean => isSedentary(t, buckets, cfg) && !excluded(t);
  const forSeries = (series: readonly Sample[]): (number | null)[] => {
    const sorted = ensureSorted(series);
    const window = sorted.slice(lowerBound(sorted, from), lowerBound(sorted, input.now));
    return hourMedians(valuesByHour(window, keep, input.timeZone));
  };
  return { stressByHour: forSeries(input.stress), hrByHour: forSeries(input.heartRate) };
};
