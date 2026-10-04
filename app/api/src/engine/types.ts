import type { ActionRule, EnergyGroup, GapLevel, MeetingType, Rating, WorkoutIntensity } from '../../../contracts/api-contract';

export type { ActionRule, EnergyGroup, GapLevel, MeetingType, Rating, WorkoutIntensity };

/** Epoch milliseconds. The engine never reads the clock; `now` is always a parameter. */
export type EpochMs = number;

export interface Sample {
  readonly t: EpochMs;
  readonly v: number;
}

export interface Interval {
  readonly start: EpochMs;
  readonly end: EpochMs;
}

export interface SleepSession {
  readonly start: EpochMs;
  readonly end: EpochMs;
  /** minutes actually asleep (excludes awake stages); falls back to (end - start) when stages are unknown */
  readonly asleepMin: number;
}

/** Everything the engine knows about a user's body. Raw samples, ascending by `t`. */
export interface HealthData {
  /** Garmin stress 0-100; unmeasurable samples (-1, -2) are already dropped */
  readonly stress: readonly Sample[];
  readonly heartRate: readonly Sample[];
  /** step counts with the start time of their interval; the engine sums them into 15-min buckets */
  readonly steps: readonly Sample[];
  readonly bodyBattery: readonly Sample[];
  /** overnight RMSSD readings in ms */
  readonly hrv: readonly Sample[];
  readonly sleeps: readonly SleepSession[];
  /** open-wearables Resilience score for the latest date, or null (the engine then computes HRV-CV itself) */
  readonly resilienceScore: number | null;
}

export interface EnginePerson {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
}

export interface EngineMeeting {
  readonly kind: 'meeting';
  readonly id: string;
  readonly title: string;
  readonly type: MeetingType;
  readonly start: EpochMs;
  readonly end: EpochMs;
  readonly attendeeIds: readonly string[];
  readonly isGroup: boolean;
}

export interface EngineWorkout {
  readonly kind: 'workout';
  readonly id: string;
  readonly title: string;
  readonly intensity: WorkoutIntensity;
  readonly start: EpochMs;
  readonly end: EpochMs;
  readonly movedByHeadroom: boolean;
}

export type EngineEvent = EngineMeeting | EngineWorkout;

export interface Reflection {
  readonly meetingId: string;
  readonly rating: Rating;
}

/** A calendar change produced by an action; persisted when the user accepts it. */
export type PlanChange =
  | {
      readonly kind: 'sleep_target';
      /** bedtime ("lights out") and wake time; the block spans the night */
      readonly bedtime: EpochMs;
      readonly wake: EpochMs;
      readonly sleepHours: number;
      readonly forDate: string;
    }
  | {
      readonly kind: 'move_workout';
      readonly workoutId: string;
      readonly start: EpochMs;
      readonly end: EpochMs;
    }
  | {
      readonly kind: 'add_block';
      readonly title: string;
      readonly start: EpochMs;
      readonly end: EpochMs;
      readonly forDate: string;
    };

export interface AcceptedChange {
  readonly actionId: string;
  readonly change: PlanChange;
}

export type InsufficientReason =
  | 'no_samples'
  | 'too_few_sedentary_samples'
  | 'no_baseline'
  | 'too_few_meetings'
  | 'no_data';

export type Measured<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'insufficient'; readonly reason: InsufficientReason; readonly detail: string };
