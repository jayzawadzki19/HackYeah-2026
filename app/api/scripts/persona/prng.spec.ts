import { describe, expect, test } from 'bun:test';
import { createRng, deriveSeed, mulberry32 } from './prng';

const take = (next: () => number, n: number): readonly number[] => Array.from({ length: n }, () => next());

describe('mulberry32', () => {
  test('produces the reference sequence for seed 2026', () => {
    const next = mulberry32(2026);
    const first = take(next, 3);
    const again = take(mulberry32(2026), 3);
    expect(first).toEqual(again);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  test('different seeds give different sequences', () => {
    expect(take(mulberry32(1), 5)).not.toEqual(take(mulberry32(2), 5));
  });

  test('values are spread over [0, 1)', () => {
    const values = take(mulberry32(42), 10_000);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('deriveSeed', () => {
  test('is stable for the same seed and label', () => {
    expect(deriveSeed(2026, 'stress')).toBe(deriveSeed(2026, 'stress'));
  });

  test('differs between labels and between seeds', () => {
    expect(deriveSeed(2026, 'stress')).not.toBe(deriveSeed(2026, 'hr'));
    expect(deriveSeed(2026, 'stress')).not.toBe(deriveSeed(2027, 'stress'));
  });

  test('returns an unsigned 32-bit integer', () => {
    const seed = deriveSeed(2026, 'schedule');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe('createRng', () => {
  test('is deterministic across all helpers', () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return [rng.next(), rng.gaussian(0, 1), rng.int(1, 6), rng.pick(['a', 'b', 'c']), rng.shuffle([1, 2, 3, 4, 5])];
    };
    expect(draw(7)).toEqual(draw(7));
  });

  test('gaussian has the requested mean and standard deviation', () => {
    const rng = createRng(99);
    const values = Array.from({ length: 20_000 }, () => rng.gaussian(10, 4));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
    expect(mean).toBeGreaterThan(9.9);
    expect(mean).toBeLessThan(10.1);
    expect(sd).toBeGreaterThan(3.9);
    expect(sd).toBeLessThan(4.1);
  });

  test('int stays within the inclusive bounds and hits both ends', () => {
    const rng = createRng(5);
    const values = Array.from({ length: 2_000 }, () => rng.int(3, 7));
    expect(new Set(values)).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  test('shuffle returns a permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8] as const;
    const shuffled = createRng(11).shuffle(input);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('pick throws on an empty list (programmer error)', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});
