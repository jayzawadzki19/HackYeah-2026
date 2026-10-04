import { localDateTime } from '../time';
import type { EngineMeeting, EngineWorkout, EpochMs, HealthData, Sample } from '../types';

/** Test-only helpers for hand-built engine fixtures. Not exported from the engine barrel. */

export const WARSAW = 'Europe/Warsaw';

export const at = (date: string, hm: string, timeZone: string = WARSAW): EpochMs => localDateTime(date, hm, timeZone);

/** Samples every `stepMin` minutes in [start, end). */
export const everyMinutes = (start: EpochMs, end: EpochMs, stepMin: number, value: (t: EpochMs) => number): Sample[] =>
  Array.from({ length: Math.max(0, Math.ceil((end - start) / (stepMin * 60_000))) }, (_, i) => {
    const t = start + i * stepMin * 60_000;
    return { t, v: value(t) };
  });

export const EMPTY_HEALTH: HealthData = {
  stress: [],
  heartRate: [],
  steps: [],
  bodyBattery: [],
  hrv: [],
  sleeps: [],
  resilienceScore: null,
};

export const healthWith = (overrides: Partial<HealthData>): HealthData => ({ ...EMPTY_HEALTH, ...overrides });

export const meeting = (overrides: Partial<EngineMeeting> & Pick<EngineMeeting, 'start' | 'end'>): EngineMeeting => ({
  kind: 'meeting',
  id: 'm1',
  title: 'Meeting',
  type: 'one_on_one',
  attendeeIds: [],
  isGroup: false,
  ...overrides,
});

export const workout = (overrides: Partial<EngineWorkout> & Pick<EngineWorkout, 'start' | 'end'>): EngineWorkout => ({
  kind: 'workout',
  id: 'w1',
  title: 'Run',
  intensity: 'easy',
  movedByHeadroom: false,
  ...overrides,
});
