/**
 * Test-only re-implementation of the engine formulas the generator must invert (docs/architecture.md section 7).
 * Kept deliberately small; the real engine lives in src/engine and is validated separately.
 */
import type { WorkoutIntensity } from '../../../src/engine/types';

export const WORKOUT_LOAD: Readonly<Record<WorkoutIntensity, number>> = { intervals: 8, tempo: 8, long: 6, easy: 2 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 7.5: clamp(0.25 * sum(load * hours) + sum(WORKOUT_LOAD), 0, 100) */
export const dayLoad = (
  meetings: readonly { readonly load: number; readonly durationH: number }[],
  workouts: readonly { readonly intensity: WorkoutIntensity }[],
): number =>
  clamp(
    0.25 * meetings.reduce((sum, m) => sum + m.load * m.durationH, 0) +
      workouts.reduce((sum, w) => sum + WORKOUT_LOAD[w.intensity], 0),
    0,
    100,
  );
