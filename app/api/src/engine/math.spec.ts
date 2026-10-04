import { describe, expect, test } from 'bun:test';
import { clamp, groupBy, mean, median, round1, roundToNearest, sampleSd } from './math';

describe('clamp', () => {
  test('keeps values inside the range and pins values outside it', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-3, 0, 100)).toBe(0);
    expect(clamp(140, 0, 100)).toBe(100);
  });
});

describe('mean', () => {
  test('averages values', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
  });

  test('returns null for an empty list instead of NaN', () => {
    expect(mean([])).toBeNull();
  });
});

describe('median', () => {
  test('takes the middle value of an odd-length list regardless of order', () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  test('averages the two middle values of an even-length list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });

  test('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('sampleSd', () => {
  test('uses the n - 1 denominator (numpy ddof=1)', () => {
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  test('returns null with fewer than two values', () => {
    expect(sampleSd([5])).toBeNull();
    expect(sampleSd([])).toBeNull();
  });
});

describe('rounding', () => {
  test('round1 rounds to one decimal', () => {
    expect(round1(24.07)).toBe(24.1);
    expect(round1(16.24)).toBe(16.2);
  });

  test('roundToNearest rounds to a step', () => {
    expect(roundToNearest(22, 5)).toBe(20);
    expect(roundToNearest(43, 5)).toBe(45);
    expect(roundToNearest(47.5, 5)).toBe(50);
  });

  test('round1 never returns negative zero', () => {
    expect(Object.is(round1(-0.01), -0)).toBe(false);
  });
});

describe('groupBy', () => {
  test('groups items by key preserving input order', () => {
    const groups = groupBy([1, 2, 3, 4, 5], (n) => (n % 2 === 0 ? 'even' : 'odd'));
    expect(groups.get('odd')).toEqual([1, 3, 5]);
    expect(groups.get('even')).toEqual([2, 4]);
  });
});
