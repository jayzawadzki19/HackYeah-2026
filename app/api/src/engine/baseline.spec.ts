import { describe, expect, test } from 'bun:test';
import { buildBaseline, isSedentary, sedentaryBuckets } from './baseline';
import { ENGINE_CONFIG } from './engine.config';
import { at, everyMinutes, WARSAW } from './testing/builders';
import type { Sample } from './types';

const NOW = at('2026-10-04', '12:00');

const baselineOf = (stress: readonly Sample[], extra: Partial<Parameters<typeof buildBaseline>[0]> = {}) =>
  buildBaseline({ stress, heartRate: [], steps: [], exclusions: [], now: NOW, timeZone: WARSAW, ...extra }, ENGINE_CONFIG);

const alternating = (a: number, b: number) => {
  let flip = false;
  return () => {
    flip = !flip;
    return flip ? a : b;
  };
};

describe('sedentaryBuckets', () => {
  test('sums step counts into 15-minute buckets keyed by bucket start', () => {
    const start = at('2026-10-03', '10:00');
    const buckets = sedentaryBuckets([
      { t: start, v: 40 },
      { t: start + 5 * 60_000, v: 30 },
      { t: start + 15 * 60_000, v: 7 },
    ]);
    expect(buckets.get(start)).toBe(70);
    expect(buckets.get(start + 15 * 60_000)).toBe(7);
  });

  test('isSedentary is true at or below the step limit and when no steps were recorded', () => {
    const start = at('2026-10-03', '10:00');
    const buckets = sedentaryBuckets([
      { t: start, v: 100 },
      { t: start + 15 * 60_000, v: 101 },
    ]);
    expect(isSedentary(start + 60_000, buckets, ENGINE_CONFIG)).toBe(true);
    expect(isSedentary(start + 16 * 60_000, buckets, ENGINE_CONFIG)).toBe(false);
    expect(isSedentary(start + 40 * 60_000, buckets, ENGINE_CONFIG)).toBe(true);
  });
});

describe('buildBaseline', () => {
  test('takes the median stress per local hour', () => {
    const stress = everyMinutes(at('2026-10-03', '10:00'), at('2026-10-03', '11:00'), 3, alternating(20, 30));
    const baseline = baselineOf(stress);
    expect(baseline.stressByHour).toHaveLength(24);
    expect(baseline.stressByHour[10]).toBe(25);
  });

  test('ignores samples inside meetings, workouts and sleep (exclusions)', () => {
    const day = '2026-10-03';
    const stress = everyMinutes(at(day, '10:00'), at(day, '11:00'), 3, (t) => (t < at(day, '10:30') ? 90 : 20));
    const baseline = baselineOf(stress, { exclusions: [{ start: at(day, '10:00'), end: at(day, '10:30') }] });
    expect(baseline.stressByHour[10]).toBe(20);
  });

  test('ignores samples whose 15-minute step bucket is above the sedentary limit', () => {
    const day = '2026-10-03';
    const stress = everyMinutes(at(day, '10:00'), at(day, '11:00'), 3, (t) => (t < at(day, '10:15') ? 90 : 20));
    const baseline = baselineOf(stress, { steps: [{ t: at(day, '10:00'), v: 500 }] });
    expect(baseline.stressByHour[10]).toBe(20);
  });

  test('uses only the last 28 days before now', () => {
    const old = everyMinutes(at('2026-09-04', '10:00'), at('2026-09-04', '11:00'), 1, () => 80);
    const recent = everyMinutes(at('2026-10-03', '10:00'), at('2026-10-03', '11:00'), 3, () => 20);
    const future = everyMinutes(at('2026-10-04', '12:00'), at('2026-10-04', '13:00'), 1, () => 99);
    expect(baselineOf([...old, ...recent]).stressByHour[10]).toBe(20);
    expect(baselineOf([...recent, ...future]).stressByHour[12]).toBe(20);
  });

  test('an hour with fewer than 10 samples borrows the neighbouring hours', () => {
    const day = '2026-10-03';
    const stress = [
      ...everyMinutes(at(day, '13:00'), at(day, '14:00'), 3, () => 30),
      ...everyMinutes(at(day, '14:00'), at(day, '14:09'), 3, () => 50),
      ...everyMinutes(at(day, '15:00'), at(day, '16:00'), 3, () => 30),
    ];
    expect(baselineOf(stress).stressByHour[14]).toBe(30);
  });

  test('builds the heart-rate baseline the same way', () => {
    const hr = everyMinutes(at('2026-10-03', '09:00'), at('2026-10-03', '10:00'), 2, () => 66);
    const baseline = buildBaseline(
      { stress: [], heartRate: hr, steps: [], exclusions: [], now: NOW, timeZone: WARSAW },
      ENGINE_CONFIG,
    );
    expect(baseline.hrByHour[9]).toBe(66);
    expect(baseline.stressByHour.every((v) => v === null)).toBe(true);
  });

  test('returns nulls, never numbers, without data', () => {
    const baseline = baselineOf([]);
    expect(baseline.stressByHour).toEqual(Array.from({ length: 24 }, () => null));
    expect(baseline.hrByHour).toEqual(Array.from({ length: 24 }, () => null));
  });

  test('buckets by local hour across the late-October DST fall-back (02:00 local happens twice)', () => {
    const cestTwo = everyMinutes(Date.parse('2026-10-25T00:00:00Z'), Date.parse('2026-10-25T01:00:00Z'), 3, () => 40);
    const cetTwo = everyMinutes(Date.parse('2026-10-25T01:00:00Z'), Date.parse('2026-10-25T02:00:00Z'), 3, () => 44);
    const three = everyMinutes(Date.parse('2026-10-25T02:00:00Z'), Date.parse('2026-10-25T03:00:00Z'), 3, () => 10);
    const baseline = buildBaseline(
      {
        stress: [...cestTwo, ...cetTwo, ...three],
        heartRate: [],
        steps: [],
        exclusions: [],
        now: at('2026-10-26', '12:00'),
        timeZone: WARSAW,
      },
      ENGINE_CONFIG,
    );
    expect(baseline.stressByHour[2]).toBe(42);
    expect(baseline.stressByHour[3]).toBe(10);
  });
});
