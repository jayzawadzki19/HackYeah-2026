import { describe, expect, test } from 'bun:test';
import type { Baseline } from '../../src/engine/baseline';
import { deriveCapacityInputs } from '../../src/engine/capacity';
import { measureMeetingLoad } from '../../src/engine/meeting-load';
import { buildNights } from '../../src/engine/nights';
import type { HealthData } from '../../src/engine/types';
import { createRng } from './prng';
import { buildSchedule, PERSONA_TIME_ZONE } from './schedule';
import { generateHealth, meetingStressExcess } from './signals';
import { localDateTime, MINUTE_MS } from './time';

const TZ = PERSONA_TIME_ZONE;
const BASELINE: Baseline = {
  stressByHour: Array.from({ length: 24 }, () => 25),
  hrByHour: Array.from({ length: 24 }, () => 68),
};

describe('meetingStressExcess', () => {
  test('holds a plateau of 0.4*L through the meeting and is within 2 after 0.5*L minutes', () => {
    expect(meetingStressExcess(90, 0, 120)).toBeCloseTo(36, 5);
    expect(meetingStressExcess(90, 119, 120)).toBeCloseTo(36, 5);
    expect(meetingStressExcess(90, 120 + 45, 120)).toBeLessThanOrEqual(2);
    expect(meetingStressExcess(90, 120 + 45, 120)).toBeGreaterThan(0);
    expect(meetingStressExcess(90, 120 + 42, 120)).toBeGreaterThan(5);
  });

  test('a noiseless meeting is measured near the injected load', () => {
    const day = '2026-10-02';
    const meetingStart = localDateTime(day, 10 * 60, TZ);
    const meetingEnd = localDateTime(day, 12 * 60, TZ);
    const load = 90;
    const durationMin = 120;
    const from = localDateTime(day, 8 * 60, TZ);
    const until = meetingEnd + 150 * MINUTE_MS;
    const stress = [];
    for (let t = from; t < until; t += 3 * MINUTE_MS) {
      const minutesFromStart = (t - meetingStart) / MINUTE_MS;
      const excess = t >= meetingStart ? meetingStressExcess(load, minutesFromStart, durationMin) : 0;
      stress.push({ t, v: 25 + excess });
    }
    const steps = [];
    for (let t = from; t < until; t += 15 * MINUTE_MS) steps.push({ t, v: 20 });
    const health: HealthData = {
      stress,
      heartRate: [],
      steps,
      bodyBattery: [],
      hrv: [],
      sleeps: [],
      resilienceScore: null,
    };
    const measured = measureMeetingLoad(
      { meeting: { start: meetingStart, end: meetingEnd }, health, baseline: BASELINE, timeZone: TZ },
    );
    expect(measured.kind).toBe('ok');
    if (measured.kind !== 'ok') return;
    expect(measured.value.excessStress).toBeCloseTo(36, 0);
    expect(Math.abs(measured.value.recoveryTailMin - 45)).toBeLessThanOrEqual(6);
    expect(Math.abs(measured.value.load - 90)).toBeLessThanOrEqual(5);
  });
});

describe('generateHealth', () => {
  const today = '2026-10-04';
  const now = localDateTime(today, 11 * 60, TZ);
  const health = generateHealth(
    buildSchedule({ today, timeZone: TZ }, createRng(2026)),
    { today, timeZone: TZ },
    now,
    createRng(2026),
  );

  test('stops at now and keeps stress on the 0-100 scale', () => {
    expect(health.stress.length).toBeGreaterThan(0);
    expect(health.stress.every((sample) => sample.t <= now && sample.v >= 0 && sample.v <= 100)).toBe(true);
    expect(health.heartRate.every((sample) => sample.t <= now)).toBe(true);
    expect(health.steps.every((sample) => sample.v < 60 || sample.v >= 400)).toBe(true);
    expect(health.resilienceScore).toBe(75);
  });

  test('reproduces the demo-day capacity inputs', () => {
    const inputs = deriveCapacityInputs(health, now, TZ);
    expect(inputs.lastSleepHours).toBeCloseTo(365 / 60, 5);
    expect(inputs.sleepAvg7dHours).toBeCloseTo(365 / 60, 5);
    expect(inputs.bodyBatteryMorning).toBe(41);
    expect(inputs.medianWakeMinutes14d).toBe(390);
    expect(inputs.resilience).toBe(75);
    expect(inputs.lastNightHrv).toBeCloseTo(0.9 * (inputs.mean7dHrv ?? 0), 1);
  });

  test('drops HRV about 15% the night after hard intervals before a board day', () => {
    const calendar = buildSchedule({ today, timeZone: TZ }, createRng(2026));
    const nights = buildNights(health.sleeps, health.hrv, TZ);
    const boardDates = calendar.events
      .filter((event) => event.kind === 'meeting' && event.type === 'board' && event.start.slice(0, 10) < today)
      .map((event) => event.start.slice(0, 10));
    expect(boardDates.length).toBe(3);
    boardDates.forEach((date) => {
      const index = nights.findIndex((night) => night.date === date);
      const night = nights[index];
      const previous = nights.slice(Math.max(0, index - 7), index).flatMap((item) => (item.hrvMean === null ? [] : [item.hrvMean]));
      const mean = previous.reduce((sum, value) => sum + value, 0) / previous.length;
      expect(night?.hrvMean).toBeCloseTo(0.85 * mean, 1);
    });
  });
});
