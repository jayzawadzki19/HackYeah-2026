import { describe, expect, test } from 'bun:test';
import type { Baseline } from './baseline';
import { ENGINE_CONFIG } from './engine.config';
import { measureMeetingLoad, meetingModifiers, modifierOffset } from './meeting-load';
import { at, everyMinutes, healthWith, meeting, WARSAW } from './testing/builders';
import type { EpochMs, HealthData, Sample } from './types';

const DAY = '2026-10-02';
const BASELINE: Baseline = {
  stressByHour: Array.from({ length: 24 }, () => 25),
  hrByHour: Array.from({ length: 24 }, () => 68),
};
const BOARD = meeting({ id: 'board', type: 'board', start: at(DAY, '10:00'), end: at(DAY, '11:00') });

/** Stress: `during` inside the meeting, `tail` until `recoveredAt`, then back to `rest`. */
const stressProfile = (opts: {
  readonly during: number;
  readonly tail: number;
  readonly recoveredAt: EpochMs;
  readonly rest?: number;
  readonly until?: EpochMs;
}): Sample[] =>
  everyMinutes(at(DAY, '09:00'), opts.until ?? at(DAY, '14:00'), 3, (t) =>
    t >= BOARD.start && t < BOARD.end ? opts.during : t >= BOARD.end && t < opts.recoveredAt ? opts.tail : (opts.rest ?? 25),
  );

const measure = (health: HealthData, baseline: Baseline = BASELINE) =>
  measureMeetingLoad({ meeting: BOARD, health, baseline, timeZone: WARSAW }, ENGINE_CONFIG);

describe('measureMeetingLoad', () => {
  test('load = 2 * excess stress + 0.4 * recovery tail minutes', () => {
    const result = measure(healthWith({ stress: stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '11:45') }) }));
    expect(result).toEqual({
      kind: 'ok',
      value: {
        load: 90,
        excessStress: 36,
        recoveryTailMin: 45,
        validSamples: 20,
        signal: 'stress',
        recoveredAt: at(DAY, '11:45'),
      },
    });
  });

  test('a single recovered sample is not enough: recovery needs consecutive samples', () => {
    const stress = stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '11:45') }).map((s) =>
      s.t === at(DAY, '11:15') ? { ...s, v: 25 } : s,
    );
    const result = measure(healthWith({ stress }));
    expect(result.kind === 'ok' && result.value.recoveryTailMin).toBe(45);
  });

  test('caps the recovery tail when stress stays high through the observed window', () => {
    const result = measure(healthWith({ stress: stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '20:00') }) }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.recoveryTailMin).toBe(120);
    expect(result.value.recoveredAt).toBeNull();
    expect(result.value.load).toBe(100);
  });

  test('is insufficient when the recovery window is not observed yet (data stops while still elevated)', () => {
    const stress = stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '20:00'), until: at(DAY, '11:30') });
    const result = measure(healthWith({ stress }));
    expect(result).toMatchObject({ kind: 'insufficient', reason: 'no_samples' });
    expect(result.kind === 'insufficient' && result.detail).toContain('recovery');
  });

  test('clamps the load at 0 for meetings calmer than the baseline', () => {
    const result = measure(healthWith({ stress: stressProfile({ during: 15, tail: 25, recoveredAt: BOARD.end }) }));
    expect(result.kind === 'ok' && result.value.load).toBe(0);
    expect(result.kind === 'ok' && result.value.excessStress).toBe(-10);
  });

  test('skips non-sedentary samples but measures the still ones', () => {
    const stress = stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '11:45') }).map((s) =>
      s.t >= BOARD.start && s.t < BOARD.start + 15 * 60_000 ? { ...s, v: 95 } : s,
    );
    const result = measure(healthWith({ stress, steps: [{ t: BOARD.start, v: 600 }] }));
    expect(result.kind === 'ok' && result.value.validSamples).toBe(15);
    expect(result.kind === 'ok' && result.value.excessStress).toBe(36);
  });

  test('is insufficient with no samples at all', () => {
    const result = measure(healthWith({}));
    expect(result).toMatchObject({ kind: 'insufficient', reason: 'no_samples' });
    expect(result.kind === 'insufficient' && result.detail.length).toBeGreaterThan(0);
  });

  test('is insufficient when the user was moving for most of the meeting', () => {
    const stress = stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '11:45') });
    const steps = everyMinutes(BOARD.start, BOARD.end, 15, () => 800);
    const result = measure(healthWith({ stress, steps }));
    expect(result).toMatchObject({ kind: 'insufficient', reason: 'too_few_sedentary_samples' });
  });

  test('is insufficient without a baseline for that time of day', () => {
    const stress = stressProfile({ during: 61, tail: 35, recoveredAt: at(DAY, '11:45') });
    const none = Array.from({ length: 24 }, () => null);
    const result = measure(healthWith({ stress }), { stressByHour: none, hrByHour: none });
    expect(result).toMatchObject({ kind: 'insufficient', reason: 'no_baseline' });
  });

  test('falls back to heart rate (excess scaled by 2) when stress is missing', () => {
    const heartRate = everyMinutes(at(DAY, '09:00'), at(DAY, '14:00'), 2, (t) =>
      t >= BOARD.start && t < BOARD.end ? 86 : t >= BOARD.end && t < at(DAY, '11:46') ? 73 : 68,
    );
    const result = measure(healthWith({ heartRate }));
    expect(result).toMatchObject({
      kind: 'ok',
      value: { signal: 'hr', excessStress: 36, recoveryTailMin: 46, load: 90.4, validSamples: 30 },
    });
  });
});

describe('meetingModifiers', () => {
  const previous = (endHm: string) =>
    meeting({ id: 'prev', start: at(DAY, '08:00'), end: at(DAY, endHm) });
  const target = meeting({ id: 'target', start: at(DAY, '09:00'), end: at(DAY, '09:30') });

  test('back-to-back when the previous meeting ends at most 5 minutes before the start', () => {
    expect(meetingModifiers(target, [previous('09:00'), target], WARSAW, ENGINE_CONFIG).backToBack).toBe(true);
    expect(meetingModifiers(target, [previous('08:55'), target], WARSAW, ENGINE_CONFIG).backToBack).toBe(true);
    expect(meetingModifiers(target, [previous('08:54'), target], WARSAW, ENGINE_CONFIG).backToBack).toBe(false);
  });

  test('a meeting is never back-to-back with itself or with a later meeting', () => {
    const later = meeting({ id: 'later', start: at(DAY, '09:30'), end: at(DAY, '10:00') });
    expect(meetingModifiers(target, [target, later], WARSAW, ENGINE_CONFIG).backToBack).toBe(false);
  });

  test('late start at or after 16:00 local time', () => {
    const late = meeting({ start: at(DAY, '16:00'), end: at(DAY, '16:30') });
    const early = meeting({ start: at(DAY, '15:59'), end: at(DAY, '16:30') });
    expect(meetingModifiers(late, [late], WARSAW, ENGINE_CONFIG).lateStart).toBe(true);
    expect(meetingModifiers(early, [early], WARSAW, ENGINE_CONFIG).lateStart).toBe(false);
  });

  test('modifierOffset adds the configured penalties', () => {
    expect(modifierOffset({ backToBack: true, lateStart: true }, ENGINE_CONFIG)).toBe(13);
    expect(modifierOffset({ backToBack: false, lateStart: false }, ENGINE_CONFIG)).toBe(0);
  });
});
