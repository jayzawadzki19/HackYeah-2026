export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const noNegativeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

export const sum = (values: readonly number[]): number => values.reduce((acc, v) => acc + v, 0);

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : sum(values) / values.length;

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Sample standard deviation (n - 1 denominator), as numpy `std(ddof=1)`. */
export const sampleSd = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const m = sum(values) / values.length;
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
};

export const round0 = (value: number): number => noNegativeZero(Math.round(value));

export const round1 = (value: number): number => noNegativeZero(Math.round(value * 10) / 10);

export const roundToNearest = (value: number, step: number): number => noNegativeZero(Math.round(value / step) * step);

export const groupBy = <T, K>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, readonly T[]> =>
  items.reduce((groups, item) => {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
    return groups;
  }, new Map<K, T[]>());
