/** Seeded randomness for the persona generator. Same seed => same sequence, on every machine. */

export type NextFloat = () => number;

/** mulberry32: tiny 32-bit PRNG, uniform floats in [0, 1). */
export const mulberry32 = (seed: number): NextFloat => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    const a = Math.imul(state ^ (state >>> 15), state | 1);
    const b = a ^ (a + Math.imul(a ^ (a >>> 7), a | 61));
    return ((b ^ (b >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** FNV-1a of `${seed}:${label}`: independent streams per concern, so changing one signal does not reshuffle the others. */
export const deriveSeed = (seed: number, label: string): number =>
  Array.from(`${seed}:${label}`).reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619) >>> 0,
    2_166_136_261,
  );

export interface Rng {
  next(): number;
  gaussian(mean: number, sd: number): number;
  /** inclusive on both ends */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): readonly T[];
}

export const createRng = (seed: number): Rng => {
  const next = mulberry32(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    // Box-Muller; 1 - u keeps the log argument in (0, 1]
    gaussian: (mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    int,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('pick() needs at least one item');
      return item;
    },
    shuffle: <T>(items: readonly T[]): readonly T[] =>
      items
        .map((item) => ({ item, key: next() }))
        .sort((a, b) => a.key - b.key)
        .map(({ item }) => item),
  };
};
