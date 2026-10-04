import type {
  AcceptedChange,
  ActionRule,
  CapacityComponentKind,
  EnergyGroup,
  EngineEvent,
  EngineMeeting,
  EnginePerson,
  EngineWorkout,
  EpochMs,
  GapLevel,
  HealthData,
  Measured,
  PlanChange,
  Rating,
  Reflection,
} from '../engine/types';

/** The engine surface the api depends on (implementation plan, Track C1.9). */
export interface ForecastInput {
  readonly now: EpochMs;
  readonly timeZone: string;
  readonly events: readonly EngineEvent[];
  readonly people: readonly EnginePerson[];
  readonly health: HealthData;
  readonly reflections: readonly Reflection[];
  readonly accepted: readonly AcceptedChange[];
}

export interface MeetingLoad {
  readonly load: number;
  readonly excessStress: number;
  readonly recoveryTailMin: number;
  readonly validSamples: number;
  readonly signal: 'stress' | 'hr';
  readonly recoveredAt: EpochMs | null;
}

export interface MeetingModifiers {
  readonly backToBack: boolean;
  readonly lateStart: boolean;
}

export interface LoadBasis {
  readonly typeMeetings: number;
  readonly personMeetings: readonly { readonly personId: string; readonly meetings: number }[];
}

export interface PredictedMeeting {
  readonly meeting: EngineMeeting;
  readonly load: number;
  readonly basis: LoadBasis;
  readonly label: string;
  readonly modifiers: MeetingModifiers;
}

export interface CapacityComponent {
  readonly kind: CapacityComponentKind;
  readonly score: number | null;
  readonly weight: number;
  readonly detail: string;
}

export interface Capacity {
  readonly score: number | null;
  readonly components: readonly CapacityComponent[];
}

export interface DayOutlook {
  readonly capacity: number | null;
  readonly dayLoad: number;
  readonly gap: number | null;
  readonly gapLevel: GapLevel | null;
}

export interface EvidenceRef {
  readonly label: string;
  readonly date?: string;
  readonly meetingId?: string;
  readonly link?: 'energy-map' | 'meeting';
}

export interface Action {
  readonly id: string;
  readonly rule: ActionRule;
  readonly title: string;
  readonly evidence: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly impact: number;
  readonly altersProjection: boolean;
  readonly change: PlanChange;
  readonly accepted: boolean;
}

export interface WeekDay {
  readonly date: string;
  readonly dayLoad: number;
  readonly capacityForecast: number | null;
  readonly meetings: readonly PredictedMeeting[];
  readonly workouts: readonly EngineWorkout[];
}

export interface EnergyEntry {
  readonly person: EnginePerson;
  readonly meetings: number;
  readonly bodyEffect: number;
  readonly felt: number | null;
  readonly reflections: number;
  readonly group: EnergyGroup;
  readonly confidence: 'high' | 'medium';
  readonly explanation: string;
}

export interface Baseline {
  readonly stressByHour: readonly (number | null)[];
  readonly hrByHour: readonly (number | null)[];
}

export interface ForecastResult {
  readonly computedAt: EpochMs;
  readonly capacityNow: Capacity;
  readonly outlook: DayOutlook;
  readonly projected: DayOutlook | null;
  readonly tomorrow: {
    readonly date: string;
    readonly dayLoad: number;
    readonly meetings: readonly PredictedMeeting[];
    readonly workouts: readonly EngineWorkout[];
    readonly heaviestInDays: number | null;
  };
  readonly upcoming: readonly PredictedMeeting[];
  readonly week: readonly WeekDay[];
  readonly actions: readonly Action[];
  readonly energyMap: { readonly entries: readonly EnergyEntry[]; readonly belowThresholdCount: number };
  readonly measured: ReadonlyMap<string, Measured<MeetingLoad>>;
  readonly baseline: Baseline;
  readonly headline: string;
}

export interface TracePoint {
  readonly t: EpochMs;
  readonly stress: number | null;
  readonly heartRate: number | null;
  readonly baselineStress: number | null;
}

export interface ForecastEngine {
  buildForecast(input: ForecastInput): ForecastResult;
  meetingTrace(meeting: EngineMeeting, health: HealthData, baseline: Baseline, timeZone: string): readonly TracePoint[];
  pendingCheckIns(
    events: readonly EngineEvent[],
    reflections: readonly Reflection[],
    now: EpochMs,
    timeZone: string,
  ): readonly EngineMeeting[];
  reflectionMessage(rating: Rating, measured: Measured<MeetingLoad> | undefined): string;
}

export const FORECAST_ENGINE = Symbol('ForecastEngine');
