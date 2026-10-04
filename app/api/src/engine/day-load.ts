import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { clamp, round0, sum } from './math';
import type { GapLevel, WorkoutIntensity } from './types';

/** Mirrors `DayOutlookDto`: gap = dayLoad - capacity. */
export interface DayOutlook {
  readonly capacity: number | null;
  readonly dayLoad: number;
  readonly gap: number | null;
  readonly gapLevel: GapLevel | null;
}

/** Architecture 7.5, rounded to a whole number. */
export const dayLoad = (
  meetings: readonly { readonly load: number; readonly durationH: number }[],
  workouts: readonly { readonly intensity: WorkoutIntensity }[],
  cfg: EngineConfig = ENGINE_CONFIG,
): number =>
  round0(
    clamp(
      cfg.DAY_LOAD_FACTOR * sum(meetings.map((m) => m.load * m.durationH)) +
        sum(workouts.map((w) => cfg.WORKOUT_LOAD[w.intensity])),
      0,
      100,
    ),
  );

export const gapLevel = (gap: number, cfg: EngineConfig = ENGINE_CONFIG): GapLevel =>
  gap >= cfg.GAP_LEVELS.red ? 'red' : gap >= cfg.GAP_LEVELS.amber ? 'amber' : 'green';

export const dayOutlook = (load: number, capacity: number | null, cfg: EngineConfig = ENGINE_CONFIG): DayOutlook => {
  const gap = capacity === null ? null : load - capacity;
  return { capacity, dayLoad: load, gap, gapLevel: gap === null ? null : gapLevel(gap, cfg) };
};
