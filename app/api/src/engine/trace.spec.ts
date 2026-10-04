import { describe, expect, test } from 'bun:test';
import type { Baseline } from './baseline';
import { ENGINE_CONFIG } from './engine.config';
import { at, everyMinutes, healthWith, meeting, WARSAW } from './testing/builders';
import { livePoints, meetingTrace } from './trace';

const DAY = '2026-10-02';
const BASELINE: Baseline = {
  stressByHour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 22 : 25)),
  hrByHour: Array.from({ length: 24 }, () => 68),
};
const BOARD = meeting({ start: at(DAY, '10:00'), end: at(DAY, '11:00') });

describe('meetingTrace', () => {
  const health = healthWith({
    stress: everyMinutes(at(DAY, '08:00'), at(DAY, '15:00'), 3, () => 30),
    heartRate: everyMinutes(at(DAY, '08:00'), at(DAY, '15:00'), 2, () => 70),
  });
  const trace = meetingTrace(BOARD, health, BASELINE, WARSAW);

  test('spans 30 minutes before the start to 120 minutes after the end', () => {
    expect(trace[0]!.t).toBe(at(DAY, '09:30'));
    expect(trace.at(-1)!.t).toBe(at(DAY, '13:00'));
  });

  test('merges stress and heart-rate timestamps, null where a series has no sample', () => {
    const point = (hm: string) => trace.find((p) => p.t === at(DAY, hm));
    expect(point('10:06')).toEqual({ t: at(DAY, '10:06'), stress: 30, heartRate: 70, baselineStress: 25 });
    expect(point('10:02')).toMatchObject({ stress: null, heartRate: 70 });
    expect(point('10:03')).toMatchObject({ stress: 30, heartRate: null });
  });

  test('uses the baseline of the local hour of each point', () => {
    expect(trace.find((p) => p.t === at(DAY, '09:33'))!.baselineStress).toBe(22);
  });

  test('is ascending and empty without data', () => {
    expect(trace.every((p, i) => i === 0 || trace[i - 1]!.t < p.t)).toBe(true);
    expect(meetingTrace(BOARD, healthWith({}), BASELINE, WARSAW)).toEqual([]);
  });
});

describe('livePoints', () => {
  test('returns the last LIVE_WINDOW_H hours up to now, ascending', () => {
    const now = at(DAY, '12:00');
    const health = healthWith({
      stress: everyMinutes(at(DAY, '06:00'), at(DAY, '12:30'), 3, () => 30),
      heartRate: everyMinutes(at(DAY, '06:00'), at(DAY, '12:30'), 2, () => 70),
    });
    const points = livePoints(health, now, ENGINE_CONFIG);
    expect(points[0]!.t).toBe(at(DAY, '09:00'));
    expect(points.at(-1)!.t).toBe(now);
    expect(points[1]).toEqual({ t: at(DAY, '09:02'), stress: null, heartRate: 70 });
  });
});
