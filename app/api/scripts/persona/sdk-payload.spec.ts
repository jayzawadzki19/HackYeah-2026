import { describe, expect, test } from 'bun:test';
import type { HealthData } from '../../src/engine/types';
import { payloadItemCount, SDK_SOURCE_NAME, toSdkPayloads } from './sdk-payload';

const at = (minute: number): number => Date.parse('2026-10-04T00:00:00Z') + minute * 60_000;

const health = (count: number): HealthData => ({
  stress: Array.from({ length: count }, (_, index) => ({ t: at(index * 3), v: 25 })),
  heartRate: [{ t: at(0), v: 68 }],
  steps: [{ t: at(0), v: 40 }],
  bodyBattery: [{ t: at(0), v: 41 }],
  hrv: [{ t: at(10), v: 55 }],
  sleeps: [{ start: at(-380), end: at(0), asleepMin: 365 }],
  resilienceScore: 75,
});

describe('toSdkPayloads', () => {
  test('uses health_connect and the Garmin / Health Connect metric identifiers', () => {
    const [payload] = toSdkPayloads(health(1), 5000);
    expect(payload?.provider).toBe('health_connect');
    expect(payload?.sdkVersion).toBe('1.0.0');
    expect(payload?.data.workouts).toEqual([]);
    const types = new Set(payload?.data.records.map((record) => record.type));
    expect(types).toEqual(
      new Set(['GARMIN_STRESS_LEVEL', 'GARMIN_BODY_BATTERY', 'HEART_RATE', 'STEP_COUNT', 'HEART_RATE_VARIABILITY']),
    );
    expect(payload?.data.records.every((record) => record.source.name === SDK_SOURCE_NAME)).toBe(true);
    expect(payload?.data.records.find((record) => record.type === 'HEART_RATE')?.unit).toBe('bpm');
    expect(payload?.data.records.find((record) => record.type === 'STEP_COUNT')?.unit).toBe('count');
    expect(payload?.data.records.find((record) => record.type === 'GARMIN_STRESS_LEVEL')?.unit).toBe('score');
    expect(payload?.data.records.find((record) => record.type === 'GARMIN_BODY_BATTERY')?.unit).toBe('percent');
    expect(payload?.data.records.find((record) => record.type === 'HEART_RATE_VARIABILITY')?.unit).toBe('ms');
    const stages = payload?.data.sleep.map((stage) => stage.stage);
    expect(stages).toContain('awake');
    expect(stages).toContain('light');
    expect(stages).toContain('deep');
    expect(stages).toContain('rem');
    expect(payload?.data.sleep.every((stage) => stage.parentId.startsWith('marta-sleep-'))).toBe(true);
  });

  test('splits into chunks of at most 5000 combined records and sleep stages', () => {
    const payloads = toSdkPayloads(health(6000), 5000);
    expect(payloads.length).toBeGreaterThan(1);
    payloads.forEach((payload) => expect(payloadItemCount(payload)).toBeLessThanOrEqual(5000));
    const ids = payloads.flatMap((payload) => [
      ...payload.data.records.map((record) => record.id),
      ...payload.data.sleep.map((stage) => stage.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(payloads.every((payload) => payload.syncSessionId.startsWith('headroom-marta:'))).toBe(true);
  });
});
