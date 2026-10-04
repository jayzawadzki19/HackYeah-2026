import { describe, expect, test } from 'bun:test';
import { capacity, deriveCapacityInputs, type CapacityInputs } from './capacity';
import { ENGINE_CONFIG } from './engine.config';
import { at, everyMinutes, healthWith, WARSAW } from './testing/builders';
import { addLocalDays } from './time';
import type { Sample, SleepSession } from './types';

const HAPPY_PATH: CapacityInputs = {
  lastSleepHours: 6 + 5 / 60,
  sleepAvg7dHours: 6 + 5 / 60,
  lastNightHrv: 49.5,
  mean7dHrv: 55,
  bodyBatteryMorning: 41,
  resilience: 75,
  resilienceSource: 'open_wearables',
  medianWakeMinutes14d: 390,
};

const NOTHING: CapacityInputs = {
  lastSleepHours: null,
  sleepAvg7dHours: null,
  lastNightHrv: null,
  mean7dHrv: null,
  bodyBatteryMorning: null,
  resilience: null,
  resilienceSource: null,
  medianWakeMinutes14d: null,
};

describe('capacity', () => {
  test('reproduces the happy-path capacity of about 54 with explained components', () => {
    const result = capacity(HAPPY_PATH, { hours: HAPPY_PATH.lastSleepHours, basis: 'last_night' }, ENGINE_CONFIG);
    expect(result.score).toBe(54);
    expect(result.components).toEqual([
      { kind: 'sleep', score: 81, weight: 0.35, detail: '6h05 last night (target 7h30)' },
      { kind: 'hrv', score: 25, weight: 0.3, detail: 'HRV 10% below your 7-day average' },
      { kind: 'bodyBattery', score: 41, weight: 0.25, detail: 'Body Battery 41 at wake-up' },
      { kind: 'resilience', score: 75, weight: 0.1, detail: 'Resilience 75 (open-wearables)' },
    ]);
  });

  test('the sleep target lifts projected capacity to about 60', () => {
    const result = capacity(HAPPY_PATH, { hours: 7.5, basis: 'target' }, ENGINE_CONFIG);
    expect(result.score).toBe(60);
    expect(result.components[0]!.detail).toBe('7h30 planned (sleep target)');
  });

  test('planned sleep from the 7-day average says so', () => {
    const result = capacity(HAPPY_PATH, { hours: HAPPY_PATH.sleepAvg7dHours, basis: 'average_7d' }, ENGINE_CONFIG);
    expect(result.components[0]!.detail).toBe('6h05 planned (your 7-day average; target 7h30)');
  });

  test('re-normalises the weights over available components; missing ones keep weight 0', () => {
    const result = capacity(
      { ...NOTHING, lastSleepHours: 6 + 5 / 60, bodyBatteryMorning: 41 },
      { hours: 6 + 5 / 60, basis: 'last_night' },
      ENGINE_CONFIG,
    );
    expect(result.score).toBe(64);
    expect(result.components.map((c) => [c.kind, c.score, c.weight])).toEqual([
      ['sleep', 81, 0.5833],
      ['hrv', null, 0],
      ['bodyBattery', 41, 0.4167],
      ['resilience', null, 0],
    ]);
    expect(result.components[1]!.detail).toBe('No HRV recorded last night');
  });

  test('without any data the score is null and every component says why', () => {
    const result = capacity(NOTHING, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(result.score).toBeNull();
    result.components.forEach((c) => {
      expect(c.score).toBeNull();
      expect(c.weight).toBe(0);
      expect(c.detail.length).toBeGreaterThan(0);
    });
  });

  test('HRV component is clamped to 0-100 and phrased by direction', () => {
    const high = capacity({ ...NOTHING, lastNightHrv: 80, mean7dHrv: 50 }, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(high.components[1]).toMatchObject({ score: 100, detail: 'HRV 60% above your 7-day average' });
    const low = capacity({ ...NOTHING, lastNightHrv: 20, mean7dHrv: 50 }, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(low.components[1]!.score).toBe(0);
    const even = capacity({ ...NOTHING, lastNightHrv: 50, mean7dHrv: 50 }, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(even.components[1]!.detail).toBe('HRV in line with your 7-day average');
  });

  test('HRV without a 7-day history is reported as missing', () => {
    const result = capacity({ ...NOTHING, lastNightHrv: 50 }, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(result.components[1]).toMatchObject({ score: null, detail: 'Not enough HRV history for a 7-day average' });
  });

  test('resilience computed from HRV stability is labelled as such', () => {
    const result = capacity({ ...NOTHING, resilience: 84, resilienceSource: 'hrv_cv' }, { hours: null, basis: 'last_night' }, ENGINE_CONFIG);
    expect(result.components[3]!.detail).toBe('Resilience 84 (HRV stability over the last 7 nights)');
  });
});

describe('deriveCapacityInputs', () => {
  const TODAY = '2026-10-04';
  const NOW = at(TODAY, '11:00');
  const nightOn = (date: string, asleepMin = 365, endHm = '06:30'): SleepSession => ({
    start: at(date, '00:25'),
    end: at(date, endHm),
    asleepMin,
  });
  const lastDays = (n: number) => Array.from({ length: n }, (_, i) => addLocalDays(TODAY, -i));
  const hrvFor = (date: string, value: number): Sample[] => everyMinutes(at(date, '01:00'), at(date, '06:00'), 10, () => value);

  test('takes last night, the 7-day average and the median wake time from sleep sessions', () => {
    const sleeps = [...lastDays(14).map((d, i) => nightOn(d, i < 7 ? 365 : 420, i % 2 === 0 ? '06:30' : '06:20')), {
      start: at(TODAY, '09:00'),
      end: at(TODAY, '09:30'),
      asleepMin: 30,
    }];
    const inputs = deriveCapacityInputs(healthWith({ sleeps }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs.lastSleepHours).toBeCloseTo(365 / 60, 9);
    expect(inputs.sleepAvg7dHours).toBeCloseTo(365 / 60, 9);
    expect(inputs.medianWakeMinutes14d).toBe(385);
  });

  test('last night must end within the 18 hours before now', () => {
    const inputs = deriveCapacityInputs(healthWith({ sleeps: [nightOn(TODAY)] }), at('2026-10-05', '02:00'), WARSAW, ENGINE_CONFIG);
    expect(inputs.lastSleepHours).toBeNull();
    expect(inputs.bodyBatteryMorning).toBeNull();
  });

  test('ignores sleep that ends after now', () => {
    const inputs = deriveCapacityInputs(healthWith({ sleeps: [nightOn(TODAY)] }), at(TODAY, '05:00'), WARSAW, ENGINE_CONFIG);
    expect(inputs.lastSleepHours).toBeNull();
  });

  test('compares last night HRV with the mean of the 7 nights before it', () => {
    const dates = lastDays(9);
    const hrv = dates.flatMap((d, i) => hrvFor(d, i === 0 ? 49.5 : i === 8 ? 10 : 55));
    const inputs = deriveCapacityInputs(healthWith({ sleeps: dates.map((d) => nightOn(d)), hrv }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs.lastNightHrv).toBe(49.5);
    expect(inputs.mean7dHrv).toBe(55);
  });

  test('Body Battery morning is the first reading within 60 minutes after waking', () => {
    const bodyBattery = [
      { t: at(TODAY, '06:15'), v: 44 },
      { t: at(TODAY, '06:45'), v: 41 },
      { t: at(TODAY, '07:00'), v: 39 },
    ];
    const inputs = deriveCapacityInputs(healthWith({ sleeps: [nightOn(TODAY)], bodyBattery }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs.bodyBatteryMorning).toBe(41);
  });

  test('Body Battery morning falls back to the max around waking when nothing follows it', () => {
    const bodyBattery = [
      { t: at(TODAY, '05:00'), v: 60 },
      { t: at(TODAY, '06:00'), v: 38 },
      { t: at(TODAY, '06:15'), v: 40 },
    ];
    const inputs = deriveCapacityInputs(healthWith({ sleeps: [nightOn(TODAY)], bodyBattery }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs.bodyBatteryMorning).toBe(40);
  });

  test('uses the open-wearables resilience score when present', () => {
    const inputs = deriveCapacityInputs(healthWith({ resilienceScore: 75 }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs).toMatchObject({ resilience: 75, resilienceSource: 'open_wearables' });
  });

  test('otherwise computes resilience from the HRV-CV of the last 7 nights (open-wearables formula)', () => {
    const values = [50, 60, 55, 45, 65, 52, 58];
    const dates = lastDays(7);
    const hrv = dates.flatMap((d, i) => hrvFor(d, values[i]!));
    const inputs = deriveCapacityInputs(healthWith({ sleeps: dates.map((d) => nightOn(d)), hrv }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs).toMatchObject({ resilience: 84, resilienceSource: 'hrv_cv' });
  });

  test('HRV-CV resilience needs at least 5 nights', () => {
    const dates = lastDays(4);
    const hrv = dates.flatMap((d, i) => hrvFor(d, 50 + i));
    const inputs = deriveCapacityInputs(healthWith({ sleeps: dates.map((d) => nightOn(d)), hrv }), NOW, WARSAW, ENGINE_CONFIG);
    expect(inputs).toMatchObject({ resilience: null, resilienceSource: null });
  });

  test('empty health yields nulls only', () => {
    expect(deriveCapacityInputs(healthWith({}), NOW, WARSAW, ENGINE_CONFIG)).toEqual(NOTHING);
  });
});
