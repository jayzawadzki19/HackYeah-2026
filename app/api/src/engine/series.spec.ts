import { describe, expect, test } from 'bun:test';
import { ensureSorted, intervalTester, lowerBound, mergeIntervals, samplesIn } from './series';
import type { Sample } from './types';

const samples: readonly Sample[] = [10, 20, 20, 30, 40].map((t, i) => ({ t, v: i }));

describe('lowerBound', () => {
  test('returns the first index whose timestamp is at or after the target', () => {
    expect(lowerBound(samples, 20)).toBe(1);
    expect(lowerBound(samples, 25)).toBe(3);
  });

  test('returns 0 before the first sample and length after the last', () => {
    expect(lowerBound(samples, 0)).toBe(0);
    expect(lowerBound(samples, 99)).toBe(5);
    expect(lowerBound([], 5)).toBe(0);
  });
});

describe('samplesIn', () => {
  test('returns the half-open window [start, end)', () => {
    expect(samplesIn(samples, 20, 40).map((s) => s.t)).toEqual([20, 20, 30]);
  });

  test('returns an empty list for an empty window', () => {
    expect(samplesIn(samples, 41, 50)).toEqual([]);
  });
});

describe('ensureSorted', () => {
  test('returns the same array when already ascending', () => {
    expect(ensureSorted(samples)).toBe(samples);
  });

  test('returns a sorted copy without mutating an unsorted input', () => {
    const unsorted: readonly Sample[] = [
      { t: 3, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 2 },
    ];
    expect(ensureSorted(unsorted).map((s) => s.t)).toEqual([1, 2, 3]);
    expect(unsorted.map((s) => s.t)).toEqual([3, 1, 2]);
  });
});

describe('mergeIntervals', () => {
  test('merges overlapping and touching intervals regardless of input order', () => {
    expect(
      mergeIntervals([
        { start: 50, end: 60 },
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 20, end: 25 },
      ]),
    ).toEqual([
      { start: 0, end: 25 },
      { start: 50, end: 60 },
    ]);
  });

  test('drops empty intervals', () => {
    expect(mergeIntervals([{ start: 5, end: 5 }])).toEqual([]);
  });
});

describe('intervalTester', () => {
  test('reports whether an instant falls inside any half-open interval', () => {
    const inside = intervalTester([
      { start: 100, end: 200 },
      { start: 0, end: 10 },
    ]);
    expect([0, 9, 10, 99, 100, 199, 200].map(inside)).toEqual([true, true, false, false, true, true, false]);
  });

  test('is always false without intervals', () => {
    expect(intervalTester([])(5)).toBe(false);
  });
});
