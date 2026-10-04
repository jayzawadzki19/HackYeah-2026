/**
 * REST + SSE contract between the Headroom api (NestJS) and web (Angular).
 * Types only: both projects import it with `import type`, so nothing here ships as runtime code.
 * Timestamps are ISO 8601 strings with offset; dates are `YYYY-MM-DD` in the user's time zone.
 */

export type IsoDateTime = string;
export type IsoDate = string;

export type UserKey = 'jakub' | 'marta';

export type MeetingType =
  | 'board'
  | 'pitch'
  | 'investor'
  | 'customer'
  | 'interview'
  | 'product_review'
  | 'one_on_one'
  | 'mentor'
  | 'team_sync'
  | 'standup';

export type WorkoutIntensity = 'easy' | 'tempo' | 'intervals' | 'long';

export type GapLevel = 'green' | 'amber' | 'red';

/** -1 drained, 0 neutral, +1 energized */
export type Rating = -1 | 0 | 1;

export interface UserSummaryDto {
  readonly key: UserKey;
  readonly displayName: string;
  readonly isSynthetic: boolean;
  readonly live: boolean;
  readonly timeZone: string;
}

export interface PersonDto {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
}

export type CapacityComponentKind = 'sleep' | 'hrv' | 'bodyBattery' | 'resilience';

export interface CapacityComponentDto {
  readonly kind: CapacityComponentKind;
  /** 0-100, or null when there is no data (the UI shows "no data", never 0) */
  readonly score: number | null;
  /** weight after re-normalisation over available components; 0 when score is null */
  readonly weight: number;
  /** human detail, e.g. "6h05 last night (target 7h30)" or "No HRV recorded last night" */
  readonly detail: string;
}

export interface CapacityDto {
  /** null only when no component has data */
  readonly score: number | null;
  readonly components: readonly CapacityComponentDto[];
}

export interface LoadBasisDto {
  readonly typeMeetings: number;
  readonly personMeetings: readonly { readonly personId: string; readonly meetings: number }[];
  /** honesty label, e.g. "Based on 1 of your meetings + population default" */
  readonly label: string;
}

export interface MeetingModifiersDto {
  readonly backToBack: boolean;
  readonly lateStart: boolean;
}

export interface PredictedMeetingDto {
  readonly id: string;
  readonly title: string;
  readonly type: MeetingType;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  readonly attendees: readonly PersonDto[];
  readonly isGroup: boolean;
  readonly predictedLoad: number;
  readonly basis: LoadBasisDto;
  readonly modifiers: MeetingModifiersDto;
}

export interface WorkoutDto {
  readonly id: string;
  readonly title: string;
  readonly intensity: WorkoutIntensity;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  /** contribution to day load (WORKOUT_LOAD) */
  readonly load: number;
  /** true when an accepted Headroom action moved it */
  readonly movedByHeadroom: boolean;
}

export type ActionRule =
  | 'sleep_target'
  | 'training_swap'
  | 'pre_meeting_reset'
  | 'buffer_walking'
  | 'recovery_block';

/** Calendar block written by Headroom when an action is accepted */
export interface BlockDto {
  readonly id: string;
  readonly actionId: string;
  readonly title: string;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  /** the day this block prepares for (e.g. "Lights out 22:45" the evening before belongs to tomorrow) */
  readonly forDate: IsoDate;
}

export interface EvidenceRefDto {
  readonly label: string;
  readonly date?: IsoDate;
  readonly meetingId?: string;
  /** client route hint, e.g. "energy-map" */
  readonly link?: 'energy-map' | 'meeting';
}

export interface ActionDto {
  /** stable for the same suggestion across recomputations, e.g. "sleep_target:2026-10-05" */
  readonly id: string;
  readonly rule: ActionRule;
  readonly title: string;
  readonly evidence: string;
  readonly evidenceRefs: readonly EvidenceRefDto[];
  readonly impact: number;
  /** only sleep and training actions change the projected capacity / load */
  readonly altersProjection: boolean;
  readonly accepted: boolean;
}

export interface DayOutlookDto {
  readonly capacity: number | null;
  readonly dayLoad: number;
  /** dayLoad - capacity; null when capacity is null */
  readonly gap: number | null;
  readonly gapLevel: GapLevel | null;
}

export interface LivePointDto {
  readonly t: IsoDateTime;
  readonly stress: number | null;
  readonly heartRate: number | null;
}

export interface LiveDto {
  readonly lastSampleAt: IsoDateTime | null;
  readonly lastSyncAt: IsoDateTime | null;
  /** last 3 hours, ascending */
  readonly points: readonly LivePointDto[];
}

export interface BriefingDto {
  readonly user: UserSummaryDto;
  readonly computedAt: IsoDateTime;
  /** true when the snapshot is older than 15 min or open-wearables was unreachable on the last recompute */
  readonly stale: boolean;
  /** e.g. "Tomorrow is your heaviest day in 6 weeks." */
  readonly headline: string;
  /** current capacity from last night's sleep, HRV, Body Battery and resilience */
  readonly capacity: CapacityDto;
  readonly tomorrow: {
    readonly date: IsoDate;
    readonly dayLoad: number;
    readonly meetings: readonly PredictedMeetingDto[];
    readonly workouts: readonly WorkoutDto[];
    /** tomorrow is the heaviest day in this many history days (null when it is not the heaviest) */
    readonly heaviestInDays: number | null;
  };
  /** tomorrow without any accepted action; capacity uses planned sleep = 7-day average */
  readonly outlook: DayOutlookDto;
  /** tomorrow with accepted actions applied; null when nothing is accepted */
  readonly projected: DayOutlookDto | null;
  /** ranked by impact, descending; the UI shows the top 3 and "Show more" */
  readonly actions: readonly ActionDto[];
  /** meetings in the next 24 h ("Coming up") */
  readonly upcoming: readonly PredictedMeetingDto[];
  /** present for live users only */
  readonly live: LiveDto | null;
}

export interface WeekDayDto {
  readonly date: IsoDate;
  readonly dayLoad: number;
  readonly capacityForecast: number | null;
  readonly meetings: readonly PredictedMeetingDto[];
  readonly workouts: readonly WorkoutDto[];
  readonly blocks: readonly BlockDto[];
}

export interface WeekDto {
  readonly computedAt: IsoDateTime;
  readonly stale: boolean;
  /** 7 days starting today */
  readonly days: readonly WeekDayDto[];
}

export interface MeasuredLoadDto {
  readonly load: number;
  readonly excessStress: number;
  readonly recoveryTailMin: number;
  readonly validSamples: number;
  readonly signal: 'stress' | 'hr';
  /** when stress returned to baseline after the meeting; null if capped */
  readonly recoveredAt: IsoDateTime | null;
}

export interface TracePointDto {
  readonly t: IsoDateTime;
  readonly stress: number | null;
  readonly heartRate: number | null;
  /** personal sedentary baseline for that hour */
  readonly baselineStress: number | null;
}

export interface PastMeetingRefDto {
  readonly id: string;
  readonly title: string;
  readonly start: IsoDateTime;
  readonly measuredLoad: number | null;
}

export interface MeetingDetailDto {
  readonly meeting: {
    readonly id: string;
    readonly title: string;
    readonly type: MeetingType;
    readonly start: IsoDateTime;
    readonly end: IsoDateTime;
    readonly attendees: readonly PersonDto[];
    readonly isGroup: boolean;
  };
  /** past meetings: measured load or the reason it could not be measured */
  readonly measured: MeasuredLoadDto | null;
  readonly insufficientReason: string | null;
  /** future meetings */
  readonly predicted: PredictedMeetingDto | null;
  /** past meetings: from 30 min before start to 120 min after end */
  readonly trace: readonly TracePointDto[];
  /** most recent first */
  readonly pastSameType: readonly PastMeetingRefDto[];
  readonly howWeMeasure: string;
}

export type EnergyGroup = 'known_drain' | 'hidden_drain' | 'energizer' | 'overestimated' | 'neutral';

export interface EnergyMapEntryDto {
  readonly person: PersonDto;
  readonly meetings: number;
  /** fitted person effect in load points (+ drains, - energizes) */
  readonly bodyEffect: number;
  /** mean reflection -1..1, null without reflections */
  readonly felt: number | null;
  readonly reflections: number;
  readonly group: EnergyGroup;
  readonly confidence: 'high' | 'medium';
  /** e.g. "Board meetings are demanding for you; Kasia herself is not." */
  readonly explanation: string;
}

export interface EnergyMapDto {
  readonly computedAt: IsoDateTime;
  readonly people: readonly EnergyMapEntryDto[];
  readonly belowThresholdCount: number;
}

export interface PendingCheckInDto {
  readonly meetingId: string;
  readonly title: string;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  readonly attendees: readonly PersonDto[];
}

export interface ReflectionRequestDto {
  readonly rating: Rating;
}

export interface ReflectionResultDto {
  readonly meetingId: string;
  readonly rating: Rating;
  /** e.g. "You felt energized. Your body disagreed: stress was about 20 points above your baseline." */
  readonly message: string;
  /** updated energy-map entries for the meeting's scored attendees */
  readonly updated: readonly EnergyMapEntryDto[];
}

export interface AcceptActionResultDto {
  readonly actionId: string;
  readonly block: BlockDto | null;
  readonly projected: DayOutlookDto;
}

export interface SyncAcceptedDto {
  readonly accepted: true;
}

export type StreamEventDto =
  | {
      readonly type: 'sync.status';
      readonly state: 'running' | 'ok' | 'error';
      readonly pushedRecords?: number;
      readonly latestSampleAt?: IsoDateTime | null;
      readonly error?: string;
      readonly at: IsoDateTime;
    }
  | { readonly type: 'forecast.updated'; readonly computedAt: IsoDateTime };

export interface ProblemDetailsDto {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
}
