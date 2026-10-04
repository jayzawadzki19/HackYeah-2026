import type {
  ActionDto,
  BlockDto,
  BriefingDto,
  CapacityDto,
  DayOutlookDto,
  EnergyMapDto,
  EnergyMapEntryDto,
  LiveDto,
  MeasuredLoadDto,
  PersonDto,
  PredictedMeetingDto,
  UserSummaryDto,
  WeekDto,
  WorkoutDto,
} from '../../../contracts/api-contract';
import type { CalendarProfile } from '../calendar/calendar.provider';
import { ENGINE_CONFIG } from '../engine/engine.config';
import type { AcceptedChange, EngineMeeting, EnginePerson, EngineWorkout, HealthData, PlanChange, Sample } from '../engine/types';
import { isoInZone, localClock } from '../common/time';
import type { Action, Capacity, DayOutlook, EnergyEntry, ForecastResult, MeetingLoad, PredictedMeeting } from './engine.port';

export const SNAPSHOT_VERSION = 1;

/** What is persisted per user; `stale` is decided at read time. */
export interface ForecastSnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly briefing: Omit<BriefingDto, 'stale'>;
  readonly week: Omit<WeekDto, 'stale'>;
  readonly energyMap: EnergyMapDto;
}

export const isForecastSnapshot = (payload: unknown): payload is ForecastSnapshot =>
  typeof payload === 'object' && payload !== null && 'version' in payload && payload.version === SNAPSHOT_VERSION;

export const toUserSummary = ({ userKey, displayName, isSynthetic, timeZone }: CalendarProfile): UserSummaryDto => ({
  key: userKey,
  displayName,
  isSynthetic,
  live: !isSynthetic,
  timeZone,
});

export interface MappingContext {
  readonly timeZone: string;
  readonly people: ReadonlyMap<string, EnginePerson>;
}

export const mappingContext = (timeZone: string, people: readonly EnginePerson[]): MappingContext => ({
  timeZone,
  people: new Map(people.map((person) => [person.id, person])),
});

const MINUTE_MS = 60_000;

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round1OrNull = (value: number | null): number | null => (value === null ? null : round1(value));

export const toPersonDto = ({ id, name, role }: EnginePerson): PersonDto => ({ id, name, role });

export const attendeesOf = (meeting: EngineMeeting, ctx: MappingContext): PersonDto[] =>
  meeting.attendeeIds.flatMap((id) => {
    const person = ctx.people.get(id);
    return person ? [toPersonDto(person)] : [];
  });

export type MeetingRefDto = Omit<PredictedMeetingDto, 'predictedLoad' | 'basis' | 'modifiers'>;

export const toMeetingRef = (meeting: EngineMeeting, ctx: MappingContext): MeetingRefDto => ({
  id: meeting.id,
  title: meeting.title,
  type: meeting.type,
  start: isoInZone(meeting.start, ctx.timeZone),
  end: isoInZone(meeting.end, ctx.timeZone),
  attendees: attendeesOf(meeting, ctx),
  isGroup: meeting.isGroup,
});

export const toPredictedMeetingDto = (predicted: PredictedMeeting, ctx: MappingContext): PredictedMeetingDto => ({
  ...toMeetingRef(predicted.meeting, ctx),
  predictedLoad: round1(predicted.load),
  basis: {
    typeMeetings: predicted.basis.typeMeetings,
    personMeetings: predicted.basis.personMeetings,
    label: predicted.label,
  },
  modifiers: predicted.modifiers,
});

export const toWorkoutDto = (workout: EngineWorkout, ctx: MappingContext): WorkoutDto => ({
  id: workout.id,
  title: workout.title,
  intensity: workout.intensity,
  start: isoInZone(workout.start, ctx.timeZone),
  end: isoInZone(workout.end, ctx.timeZone),
  load: ENGINE_CONFIG.WORKOUT_LOAD[workout.intensity],
  movedByHeadroom: workout.movedByHeadroom,
});

const toCapacityDto = (capacity: Capacity): CapacityDto => ({
  score: round1OrNull(capacity.score),
  components: capacity.components.map((component) => ({ ...component, score: round1OrNull(component.score) })),
});

export const toOutlookDto = (outlook: DayOutlook): DayOutlookDto => ({
  capacity: round1OrNull(outlook.capacity),
  dayLoad: round1(outlook.dayLoad),
  gap: round1OrNull(outlook.gap),
  gapLevel: outlook.gapLevel,
});

const toActionDto = ({ change: _change, impact, ...action }: Action): ActionDto => ({ ...action, impact: round1(impact) });

export const toEnergyEntryDto = (entry: EnergyEntry): EnergyMapEntryDto => ({
  ...entry,
  person: toPersonDto(entry.person),
  bodyEffect: round1(entry.bodyEffect),
  felt: entry.felt === null ? null : Math.round(entry.felt * 100) / 100,
});

export const toMeasuredDto = (measured: MeetingLoad, ctx: MappingContext): MeasuredLoadDto => ({
  load: round1(measured.load),
  excessStress: round1(measured.excessStress),
  recoveryTailMin: Math.round(measured.recoveryTailMin),
  validSamples: measured.validSamples,
  signal: measured.signal,
  recoveredAt: measured.recoveredAt === null ? null : isoInZone(measured.recoveredAt, ctx.timeZone),
});

/** The calendar block an accepted change writes; moved workouts change the workout itself instead. */
export const blockFromChange = (actionId: string, change: PlanChange, ctx: MappingContext): BlockDto | null => {
  const block = (title: string, start: number, end: number, forDate: string): BlockDto => ({
    id: `block:${actionId}`,
    actionId,
    title,
    start: isoInZone(start, ctx.timeZone),
    end: isoInZone(end, ctx.timeZone),
    forDate,
  });
  switch (change.kind) {
    case 'sleep_target':
      return block(`Lights out ${localClock(change.bedtime, ctx.timeZone)}`, change.bedtime, change.wake, change.forDate);
    case 'add_block':
      return block(change.title, change.start, change.end, change.forDate);
    case 'move_workout':
      return null;
  }
};

const latestTime = (series: readonly Sample[]): number | null =>
  series.reduce<number | null>((latest, { t }) => (latest === null || t > latest ? t : latest), null);

/** Last LIVE_WINDOW_H hours of stress and heart rate, one point per minute (last sample in the minute wins). */
export const liveDto = (health: HealthData, now: number, lastSyncAt: number | null, ctx: MappingContext): LiveDto => {
  const from = now - ENGINE_CONFIG.LIVE_WINDOW_H * 60 * MINUTE_MS;
  const inWindow = (series: readonly Sample[]) => series.filter(({ t }) => t > from && t <= now);
  const minuteOf = (t: number) => Math.floor(t / MINUTE_MS) * MINUTE_MS;
  const stressByMinute = new Map(inWindow(health.stress).map(({ t, v }) => [minuteOf(t), v]));
  const heartRateByMinute = new Map(inWindow(health.heartRate).map(({ t, v }) => [minuteOf(t), v]));
  const minutes = [...new Set([...stressByMinute.keys(), ...heartRateByMinute.keys()])].toSorted((a, b) => a - b);
  const lastSampleAt = latestTime([...health.stress, ...health.heartRate]);
  return {
    lastSampleAt: lastSampleAt === null ? null : isoInZone(lastSampleAt, ctx.timeZone),
    lastSyncAt: lastSyncAt === null ? null : isoInZone(lastSyncAt, ctx.timeZone),
    points: minutes.map((minute) => ({
      t: isoInZone(minute, ctx.timeZone),
      stress: stressByMinute.get(minute) ?? null,
      heartRate: heartRateByMinute.get(minute) ?? null,
    })),
  };
};

export interface SnapshotContext {
  readonly user: UserSummaryDto;
  readonly accepted: readonly AcceptedChange[];
  readonly live: LiveDto | null;
  readonly ctx: MappingContext;
}

export const buildSnapshot = (result: ForecastResult, { user, accepted, live, ctx }: SnapshotContext): ForecastSnapshot => {
  const computedAt = isoInZone(result.computedAt, ctx.timeZone);
  const meetings = (list: readonly PredictedMeeting[]) => list.map((meeting) => toPredictedMeetingDto(meeting, ctx));
  const workouts = (list: readonly EngineWorkout[]) => list.map((workout) => toWorkoutDto(workout, ctx));
  const blocks = accepted.flatMap(({ actionId, change }) => {
    const block = blockFromChange(actionId, change, ctx);
    return block ? [block] : [];
  });
  return {
    version: SNAPSHOT_VERSION,
    briefing: {
      user,
      computedAt,
      headline: result.headline,
      capacity: toCapacityDto(result.capacityNow),
      tomorrow: {
        date: result.tomorrow.date,
        dayLoad: round1(result.tomorrow.dayLoad),
        meetings: meetings(result.tomorrow.meetings),
        workouts: workouts(result.tomorrow.workouts),
        heaviestInDays: result.tomorrow.heaviestInDays,
      },
      outlook: toOutlookDto(result.outlook),
      projected: result.projected === null ? null : toOutlookDto(result.projected),
      actions: result.actions.map(toActionDto),
      upcoming: meetings(result.upcoming),
      live,
    },
    week: {
      computedAt,
      days: result.week.map((day) => ({
        date: day.date,
        dayLoad: round1(day.dayLoad),
        capacityForecast: round1OrNull(day.capacityForecast),
        meetings: meetings(day.meetings),
        workouts: workouts(day.workouts),
        blocks: blocks.filter((block) => block.forDate === day.date),
      })),
    },
    energyMap: {
      computedAt,
      people: result.energyMap.entries.map(toEnergyEntryDto),
      belowThresholdCount: result.energyMap.belowThresholdCount,
    },
  };
};
