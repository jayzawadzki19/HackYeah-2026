import type { EpochMs, Interval, Sample } from './types';

/** First index whose `t` is at or after `t`; `items.length` when none is. Items ascending by `t`. */
export const lowerBound = (items: readonly { readonly t: EpochMs }[], t: EpochMs): number => {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Samples with `start <= t < end`. */
export const samplesIn = (samples: readonly Sample[], start: EpochMs, end: EpochMs): readonly Sample[] =>
  samples.slice(lowerBound(samples, start), lowerBound(samples, end));

const isAscending = (samples: readonly Sample[]): boolean => samples.every((s, i) => i === 0 || samples[i - 1]!.t <= s.t);

/** The input itself when ascending by `t`, otherwise a sorted copy. */
export const ensureSorted = (samples: readonly Sample[]): readonly Sample[] =>
  isAscending(samples) ? samples : [...samples].sort((a, b) => a.t - b.t);

/** Sorted, non-overlapping intervals; touching intervals are joined and empty ones dropped. */
export const mergeIntervals = (intervals: readonly Interval[]): readonly Interval[] =>
  [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)
    .reduce<Interval[]>((merged, current) => {
      const last = merged.at(-1);
      if (last && current.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, current.end) };
      else merged.push(current);
      return merged;
    }, []);

/** Predicate "is `t` inside any of the half-open intervals", O(log n) per call. */
export const intervalTester = (intervals: readonly Interval[]): ((t: EpochMs) => boolean) => {
  const merged = mergeIntervals(intervals);
  const starts = merged.map((i) => ({ t: i.start }));
  return (t) => {
    const candidate = merged[lowerBound(starts, t + 1) - 1];
    return candidate !== undefined && t < candidate.end;
  };
};
