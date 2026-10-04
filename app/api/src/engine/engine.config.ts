import type { CapacityComponentKind, MeetingType, WorkoutIntensity } from './types';

/** Engine parameters: architecture section 7.1 plus the implementation-plan additions. */
export interface EngineConfig {
  readonly BASELINE_LOOKBACK_DAYS: number;
  readonly SEDENTARY_MAX_STEPS_PER_15MIN: number;
  readonly MIN_VALID_SAMPLES_PER_MEETING: number;
  readonly RECOVERY_EPSILON: number;
  readonly RECOVERY_CONSECUTIVE: number;
  readonly RECOVERY_CAP_MIN: number;
  readonly SHRINKAGE_PSEUDO_MEETINGS: number;
  readonly MIN_MEETINGS_PER_PERSON: number;
  readonly BACK_TO_BACK_GAP_MIN: number;
  readonly BACK_TO_BACK_PENALTY: number;
  readonly LATE_START_HOUR: number;
  readonly LATE_START_PENALTY: number;
  readonly DAY_LOAD_FACTOR: number;
  readonly WORKOUT_LOAD: Readonly<Record<WorkoutIntensity, number>>;
  readonly CAPACITY_WEIGHTS: Readonly<Record<CapacityComponentKind, number>>;
  readonly SLEEP_TARGET_H: number;
  readonly SLEEP_LATENCY_MIN: number;
  readonly GAP_LEVELS: { readonly red: number; readonly amber: number };
  readonly TYPE_PRIORS: Readonly<Record<MeetingType, number>>;
  readonly TRAINING_SWAP_TARGET_MAX_DAY_LOAD: number;
  readonly HEAVY_DAY_LOAD: number;
  readonly HISTORY_DAYS: number;
  readonly RESILIENCE_CV_CEILING_PCT: number;
  readonly RESILIENCE_CV_FLOOR_PCT: number;
  readonly LIVE_WINDOW_H: number;
}

export const ENGINE_CONFIG: EngineConfig = {
  BASELINE_LOOKBACK_DAYS: 28,
  SEDENTARY_MAX_STEPS_PER_15MIN: 100,
  MIN_VALID_SAMPLES_PER_MEETING: 5,
  RECOVERY_EPSILON: 5,
  RECOVERY_CONSECUTIVE: 2,
  RECOVERY_CAP_MIN: 120,
  SHRINKAGE_PSEUDO_MEETINGS: 3,
  MIN_MEETINGS_PER_PERSON: 3,
  BACK_TO_BACK_GAP_MIN: 5,
  BACK_TO_BACK_PENALTY: 8,
  LATE_START_HOUR: 16,
  LATE_START_PENALTY: 5,
  DAY_LOAD_FACTOR: 0.25,
  WORKOUT_LOAD: { intervals: 8, tempo: 8, long: 6, easy: 2 },
  CAPACITY_WEIGHTS: { sleep: 0.35, hrv: 0.3, bodyBattery: 0.25, resilience: 0.1 },
  SLEEP_TARGET_H: 7.5,
  SLEEP_LATENCY_MIN: 15,
  GAP_LEVELS: { red: 20, amber: 8 },
  TYPE_PRIORS: {
    board: 70,
    pitch: 75,
    investor: 65,
    customer: 50,
    interview: 45,
    product_review: 40,
    one_on_one: 35,
    mentor: 35,
    team_sync: 25,
    standup: 15,
  },
  TRAINING_SWAP_TARGET_MAX_DAY_LOAD: 30,
  HEAVY_DAY_LOAD: 70,
  HISTORY_DAYS: 42,
  RESILIENCE_CV_CEILING_PCT: 7,
  RESILIENCE_CV_FLOOR_PCT: 40,
  LIVE_WINDOW_H: 3,
};
