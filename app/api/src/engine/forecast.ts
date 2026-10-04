import { buildBaseline, type Baseline } from './baseline';
import { capacity, deriveCapacityInputs, type CapacityResult } from './capacity';
import { dayLoad, dayOutlook, type DayOutlook } from './day-load';
import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { energyMap as buildEnergyMap, type EnergyMap } from './energy-map';
import { formatClock } from './format';
import { fitLoadModel, predictMeetingLoad, type LoadBasis, type LoadModel, type MeetingPrediction } from './load-model';
import { round0, roundToNearest } from './math';
import { measureMeetingLoad, meetingModifiers, type MeetingLoad, type MeetingModifiers } from './meeting-load';
import { buildNights } from './nights';
import { recommendActions, type Action, type RecommendDay } from './recommendations';
import { meetingTrace as traceMeeting, type TracePoint } from './trace';
import { addLocalDays, DAY_MS, HOUR_MS, localDate } from './time';
import type {
  AcceptedChange,
  EngineEvent,
  EngineMeeting,
  EnginePerson,
  EngineWorkout,
  EpochMs,
  HealthData,
  Measured,
  Rating,
  Reflection,
} from './types';

export interface ForecastInput {
  readonly now: EpochMs;
  readonly timeZone: string;
  readonly events: readonly EngineEvent[];
  readonly people: readonly EnginePerson[];
  readonly health: HealthData;
  readonly reflections: readonly Reflection[];
  readonly accepted: readonly AcceptedChange[];
}

export interface PredictedMeeting {
  readonly meeting: EngineMeeting;
  readonly load: number;
  readonly basis: LoadBasis;
  readonly label: string;
  readonly modifiers: MeetingModifiers;
}

export interface ForecastBlock {
  readonly id: string;
  readonly actionId: string;
  readonly title: string;
  readonly start: EpochMs;
  readonly end: EpochMs;
  readonly forDate: string;
}

export interface ForecastDay {
  readonly date: string;
  readonly dayLoad: number;
  readonly capacityForecast: number | null;
  readonly meetings: readonly PredictedMeeting[];
  readonly workouts: readonly EngineWorkout[];
  readonly blocks: readonly ForecastBlock[];
}

export interface ForecastResult {
  readonly computedAt: EpochMs;
  readonly headline: string;
  readonly capacityNow: CapacityResult;
  readonly outlook: DayOutlook;
  readonly projected: DayOutlook | null;
  readonly tomorrow: {
    readonly date: string;
    readonly dayLoad: number;
    readonly heaviestInDays: number | null;
    readonly meetings: readonly PredictedMeeting[];
    readonly workouts: readonly EngineWorkout[];
  };
  readonly week: readonly ForecastDay[];
  readonly actions: readonly Action[];
  readonly upcoming: readonly PredictedMeeting[];
  readonly measured: ReadonlyMap<string, Measured<MeetingLoad>>;
  readonly energyMap: EnergyMap;
  readonly model: LoadModel;
  readonly baseline: Baseline;
}

const isMeeting = (event: EngineEvent): event is EngineMeeting => event.kind === 'meeting';

const meetingsOn = (meetings: readonly EngineMeeting[], date: string, timeZone: string): readonly EngineMeeting[] =>
  meetings.filter((meeting) => localDate(meeting.start, timeZone) === date).sort((a, b) => a.start - b.start);

const workoutsOn = (workouts: readonly EngineWorkout[], date: string, timeZone: string): readonly EngineWorkout[] =>
  workouts.filter((workout) => localDate(workout.start, timeZone) === date).sort((a, b) => a.start - b.start);

const applyMoves = (workouts: readonly EngineWorkout[], accepted: readonly AcceptedChange[]): readonly EngineWorkout[] => {
  const moves = new Map(
    accepted.flatMap((item) => (item.change.kind === 'move_workout' ? [[item.change.workoutId, item.change] as const] : [])),
  );
  return workouts.map((workout) => {
    const move = moves.get(workout.id);
    return move ? { ...workout, start: move.start, end: move.end, movedByHeadroom: true } : workout;
  });
};

const blocksOf = (accepted: readonly AcceptedChange[], timeZone: string): readonly ForecastBlock[] =>
  accepted.flatMap((item): ForecastBlock[] => {
    const { change } = item;
    if (change.kind === 'sleep_target') {
      return [
        {
          id: item.actionId,
          actionId: item.actionId,
          title: `Lights out ${formatClock(change.bedtime, timeZone)}`,
          start: change.bedtime,
          end: change.wake,
          forDate: change.forDate,
        },
      ];
    }
    if (change.kind === 'add_block') {
      return [
        {
          id: item.actionId,
          actionId: item.actionId,
          title: change.title,
          start: change.start,
          end: change.end,
          forDate: change.forDate,
        },
      ];
    }
    return [];
  });

const loadOf = (meetings: readonly PredictedMeeting[], workouts: readonly EngineWorkout[], cfg: EngineConfig): number =>
  dayLoad(
    meetings.map((item) => ({ load: item.load, durationH: (item.meeting.end - item.meeting.start) / HOUR_MS })),
    workouts,
    cfg,
  );

const scoreDay = (
  date: string,
  meetings: readonly EngineMeeting[],
  workouts: readonly EngineWorkout[],
  measured: ReadonlyMap<string, Measured<MeetingLoad>>,
  model: LoadModel,
  now: EpochMs,
  timeZone: string,
  cfg: EngineConfig,
): { readonly meetings: readonly PredictedMeeting[]; readonly workouts: readonly EngineWorkout[]; readonly dayLoad: number } => {
  const dayMeetings = meetingsOn(meetings, date, timeZone);
  const scored = dayMeetings.map((meeting) => {
    const modifiers = meetingModifiers(meeting, dayMeetings, timeZone, cfg);
    const predicted: MeetingPrediction = predictMeetingLoad(model, meeting, modifiers, cfg);
    const measurement = measured.get(meeting.id);
    const load = meeting.end <= now && measurement?.kind === 'ok' ? round0(measurement.value.load) : predicted.load;
    return { meeting, load, basis: predicted.basis, label: predicted.label, modifiers };
  });
  const dayWorkouts = workoutsOn(workouts, date, timeZone);
  return { meetings: scored, workouts: dayWorkouts, dayLoad: loadOf(scored, dayWorkouts, cfg) };
};

const headlineOf = (
  heaviest: boolean,
  upcoming: readonly PredictedMeeting[],
  outlook: DayOutlook,
  historyDays: number,
  heavyLoad: number,
  timeZone: string,
): string => {
  if (heaviest) return `Tomorrow is your heaviest day in ${Math.round(historyDays / 7)} weeks.`;
  const demanding = upcoming.find((item) => item.load >= heavyLoad);
  if (demanding) {
    return `${demanding.meeting.title} at ${formatClock(demanding.meeting.start, timeZone)} will be demanding. Protect your headroom before it.`;
  }
  if (outlook.gapLevel === 'red' || outlook.gapLevel === 'amber') return 'Tomorrow asks more than you have in the tank.';
  return 'You have headroom for tomorrow.';
};

/** Full forecast. `now` and `timeZone` come from the caller; this function does not read the clock. */
export const buildForecast = (input: ForecastInput, cfg: EngineConfig = ENGINE_CONFIG): ForecastResult => {
  const { now, timeZone, health, people, reflections, accepted } = input;
  const today = localDate(now, timeZone);
  const tomorrow = addLocalDays(today, 1);
  const meetings = input.events.filter(isMeeting);
  const baseWorkouts = input.events.filter((event): event is EngineWorkout => event.kind === 'workout');
  const plannedWorkouts = applyMoves(baseWorkouts, accepted);
  const historyFrom = addLocalDays(today, -cfg.HISTORY_DAYS);
  const pastMeetings = meetings.filter((meeting) => meeting.end <= now && localDate(meeting.start, timeZone) >= historyFrom);

  const baseline = buildBaseline(
    {
      stress: health.stress,
      heartRate: health.heartRate,
      steps: health.steps,
      exclusions: [
        ...pastMeetings.map((meeting) => ({ start: meeting.start, end: meeting.end })),
        ...baseWorkouts.map((workout) => ({ start: workout.start, end: workout.end })),
        ...health.sleeps.map((sleep) => ({ start: sleep.start, end: sleep.end })),
      ],
      now,
      timeZone,
    },
    cfg,
  );

  const measured = new Map(
    pastMeetings.map((meeting) => [meeting.id, measureMeetingLoad({ meeting, health, baseline, timeZone }, cfg)] as const),
  );
  const model = fitLoadModel(
    pastMeetings.flatMap((meeting) => {
      const measurement = measured.get(meeting.id);
      if (measurement?.kind !== 'ok') return [];
      const sameDay = meetingsOn(meetings, localDate(meeting.start, timeZone), timeZone);
      return [{ meeting, load: measurement.value.load, modifiers: meetingModifiers(meeting, sameDay, timeZone, cfg) }];
    }),
    cfg,
  );

  const weekDates = Array.from({ length: 7 }, (_, index) => addLocalDays(today, index));
  const historyDates = Array.from({ length: cfg.HISTORY_DAYS }, (_, index) => addLocalDays(today, -cfg.HISTORY_DAYS + index));
  const baseDays = new Map(
    [...historyDates, ...weekDates].map((date) => [date, scoreDay(date, meetings, baseWorkouts, measured, model, now, timeZone, cfg)]),
  );
  const plannedDays = new Map(weekDates.map((date) => [date, scoreDay(date, meetings, plannedWorkouts, measured, model, now, timeZone, cfg)]));

  const inputs = deriveCapacityInputs(health, now, timeZone, cfg);
  const capacityNow = capacity(inputs, { hours: inputs.lastSleepHours, basis: 'last_night' }, cfg);
  const outlookCapacity = capacity(inputs, { hours: inputs.sleepAvg7dHours, basis: 'average_7d' }, cfg);
  const baseTomorrow = baseDays.get(tomorrow)!;
  const outlook = dayOutlook(baseTomorrow.dayLoad, outlookCapacity.score, cfg);

  const recommendDays: RecommendDay[] = weekDates.map((date) => ({
    date,
    meetings: baseDays.get(date)!.meetings,
    workouts: baseDays.get(date)!.workouts,
    capacity: outlookCapacity.score,
  }));
  const acceptedIds = new Set(accepted.map((item) => item.actionId));
  const actions = recommendActions(
    {
      now,
      timeZone,
      today,
      tomorrow,
      tomorrowDayLoad: baseTomorrow.dayLoad,
      tomorrowGap: outlook.gap,
      medianWakeMinutes14d: inputs.medianWakeMinutes14d,
      days: recommendDays,
      people,
      energy: buildEnergyMap(model, pastMeetings, reflections, people, cfg).entries,
      pastMeetings: pastMeetings.flatMap((meeting) => {
        const measurement = measured.get(meeting.id);
        return measurement?.kind === 'ok' ? [{ meeting, measured: measurement.value }] : [];
      }),
      pastWorkouts: baseWorkouts.filter((workout) => workout.end <= now),
      historyDayLoads: historyDates.map((date) => ({ date, dayLoad: baseDays.get(date)!.dayLoad })),
      nights: buildNights(health.sleeps, health.hrv, timeZone),
    },
    cfg,
  ).map((item) => ({ ...item, accepted: acceptedIds.has(item.id) }));

  const sleepChange = accepted.find((item) => item.change.kind === 'sleep_target')?.change;
  const projectedCapacity =
    sleepChange?.kind === 'sleep_target'
      ? capacity(inputs, { hours: sleepChange.sleepHours, basis: 'target' }, cfg)
      : outlookCapacity;
  const plannedTomorrow = plannedDays.get(tomorrow)!;
  const projected = accepted.length === 0 ? null : dayOutlook(plannedTomorrow.dayLoad, projectedCapacity.score, cfg);
  const historyMax = Math.max(...historyDates.map((date) => baseDays.get(date)!.dayLoad));
  const heaviestInDays = plannedTomorrow.dayLoad > historyMax ? cfg.HISTORY_DAYS : null;
  const upcoming = weekDates
    .flatMap((date) => plannedDays.get(date)!.meetings)
    .filter((item) => item.meeting.start > now && item.meeting.start <= now + 24 * HOUR_MS);
  const blocks = blocksOf(accepted, timeZone);

  return {
    computedAt: now,
    headline: headlineOf(heaviestInDays !== null, upcoming, outlook, cfg.HISTORY_DAYS, cfg.HEAVY_DAY_LOAD, timeZone),
    capacityNow,
    outlook,
    projected,
    tomorrow: {
      date: tomorrow,
      dayLoad: plannedTomorrow.dayLoad,
      heaviestInDays,
      meetings: plannedTomorrow.meetings,
      workouts: plannedTomorrow.workouts,
    },
    week: weekDates.map((date) => {
      const day = plannedDays.get(date)!;
      return {
        date,
        dayLoad: day.dayLoad,
        capacityForecast: outlookCapacity.score,
        meetings: day.meetings,
        workouts: day.workouts,
        blocks: blocks.filter((block) => block.forDate === date),
      };
    }),
    actions,
    upcoming,
    measured,
    energyMap: buildEnergyMap(model, pastMeetings, reflections, people, cfg),
    model,
    baseline,
  };
};

export const meetingTrace = (
  meeting: Pick<EngineMeeting, 'start' | 'end'>,
  health: HealthData,
  baseline: Baseline,
  timeZone: string,
): readonly TracePoint[] => traceMeeting(meeting, health, baseline, timeZone);

/** Past non-group meetings with an attendee, ended within 7 days, still without a reflection. Newest first. */
export const pendingCheckIns = (
  events: readonly EngineEvent[],
  reflections: readonly Reflection[],
  now: EpochMs,
  timeZone: string,
): readonly EngineMeeting[] => {
  const answered = new Set(reflections.map((item) => item.meetingId));
  return events
    .filter(isMeeting)
    .filter(
      (meeting) =>
        !meeting.isGroup &&
        meeting.attendeeIds.length > 0 &&
        !answered.has(meeting.id) &&
        meeting.end <= now &&
        meeting.end > now - 7 * DAY_MS,
    )
    .sort((a, b) => b.end - a.end);
};

const feltWord = (rating: Rating): string => (rating === -1 ? 'drained' : rating === 0 ? 'neutral' : 'energized');

/** The one line shown after a check-in: agreement, or the gap between the rating and the measured stress. */
export const reflectionMessage = (rating: Rating, measured?: Measured<MeetingLoad>): string => {
  const word = feltWord(rating);
  if (measured?.kind !== 'ok') return `You felt ${word}.`;
  const excess = measured.value.excessStress;
  if (rating >= 0 && excess >= 10) {
    return `You felt ${word}. Your body disagreed: stress was about ${roundToNearest(excess, 5)} points above your baseline.`;
  }
  if (rating === -1 && excess < 5) return 'You felt drained, but your body stayed calm.';
  return `You felt ${word}. Your body agreed.`;
};
