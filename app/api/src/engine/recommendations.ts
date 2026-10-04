import { dayLoad } from './day-load';
import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import type { EnergyEntry } from './energy-map';
import { capitalize, firstName, formatClock, formatHoursMinutes, typePlural, weekdayName } from './format';
import { round0, round1 } from './math';
import type { MeetingModifiers } from './meeting-load';
import type { Night } from './nights';
import { addLocalDays, HOUR_MS, localDate, localDateTime, MINUTE_MS, startOfLocalDay } from './time';
import type {
  ActionRule,
  EngineMeeting,
  EnginePerson,
  EngineWorkout,
  EpochMs,
  MeetingLoad,
  PlanChange,
} from './types';

export interface ScoredMeeting {
  readonly meeting: EngineMeeting;
  readonly load: number;
  readonly modifiers: MeetingModifiers;
}

export interface RecommendDay {
  readonly date: string;
  readonly meetings: readonly ScoredMeeting[];
  readonly workouts: readonly EngineWorkout[];
  readonly capacity: number | null;
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
  readonly accepted: boolean;
  readonly change: PlanChange;
}

export interface RecommendInput {
  readonly now: EpochMs;
  readonly timeZone: string;
  readonly today: string;
  readonly tomorrow: string;
  readonly tomorrowDayLoad: number;
  readonly tomorrowGap: number | null;
  readonly medianWakeMinutes14d: number | null;
  readonly days: readonly RecommendDay[];
  readonly people: readonly EnginePerson[];
  readonly energy: readonly EnergyEntry[];
  readonly pastMeetings: readonly { readonly meeting: EngineMeeting; readonly measured: MeetingLoad }[];
  readonly pastWorkouts: readonly EngineWorkout[];
  readonly historyDayLoads: readonly { readonly date: string; readonly dayLoad: number }[];
  readonly nights: readonly Night[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const RULE_ORDER: readonly ActionRule[] = [
  'sleep_target',
  'training_swap',
  'pre_meeting_reset',
  'buffer_walking',
  'recovery_block',
];
const HARD_INTENSITY = new Set(['intervals', 'tempo']);
const WALK_MIN = 10;
const BUFFER_SHIFT_MIN = 15;
const RECOVERY_MIN = 30;

const shortDate = (date: string): string => {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
};

const durationH = (event: { start: EpochMs; end: EpochMs }): number => (event.end - event.start) / HOUR_MS;

const durationMin = (event: { start: EpochMs; end: EpochMs }): number => Math.round((event.end - event.start) / MINUTE_MS);

const dayLoadOf = (day: RecommendDay, cfg: EngineConfig, skipWorkoutId?: string): number =>
  dayLoad(
    day.meetings.map((item) => ({ load: item.load, durationH: durationH(item.meeting) })),
    day.workouts.filter((workout) => workout.id !== skipWorkoutId),
    cfg,
  );

const impactOf = (related: number, gap: number | null): number => round1((related * Math.max(gap ?? 0, 0)) / 100);

const overlaps = (a: { start: EpochMs; end: EpochMs }, b: { start: EpochMs; end: EpochMs }): boolean =>
  a.start < b.end && b.start < a.end;

const eventsOf = (day: RecommendDay): readonly { readonly id: string; readonly start: EpochMs; readonly end: EpochMs }[] => [
  ...day.meetings.map((item) => item.meeting),
  ...day.workouts,
];

const action = (
  fields: Omit<Action, 'accepted' | 'evidenceRefs'> & { readonly evidenceRefs?: readonly EvidenceRef[] },
): Action => ({ ...fields, evidenceRefs: fields.evidenceRefs ?? [], accepted: false });

const sleepAction = (input: RecommendInput, cfg: EngineConfig): Action | null => {
  const { tomorrowGap, tomorrowDayLoad, medianWakeMinutes14d } = input;
  const triggered = (tomorrowGap !== null && tomorrowGap >= cfg.GAP_LEVELS.amber) || tomorrowDayLoad >= cfg.HEAVY_DAY_LOAD;
  if (!triggered || medianWakeMinutes14d === null) return null;
  const wake = startOfLocalDay(input.tomorrow, input.timeZone) + medianWakeMinutes14d * MINUTE_MS;
  const bedtime = wake - (cfg.SLEEP_TARGET_H * 60 + cfg.SLEEP_LATENCY_MIN) * MINUTE_MS;
  const lightsOut = formatClock(bedtime, input.timeZone);
  return action({
    id: `sleep_target:${input.tomorrow}`,
    rule: 'sleep_target',
    title: `Lights out by ${lightsOut}`,
    evidence: `You usually wake at ${formatClock(wake, input.timeZone)}. ${formatHoursMinutes(cfg.SLEEP_TARGET_H)} of sleep before a ${weekdayName(input.tomorrow)} this heavy means lights out by ${lightsOut}.`,
    impact: impactOf(tomorrowDayLoad, tomorrowGap),
    altersProjection: true,
    change: { kind: 'sleep_target', bedtime, wake, sleepHours: cfg.SLEEP_TARGET_H, forDate: input.tomorrow },
  });
};

const trainingEvidence = (
  input: RecommendInput,
  cfg: EngineConfig,
): { readonly evidence: string; readonly evidenceRefs: readonly EvidenceRef[] } => {
  const fallback = {
    evidence: 'Hard training the evening before a heavy day adds load when you have the least headroom.',
    evidenceRefs: [],
  };
  const heavy = new Map(input.historyDayLoads.filter((day) => day.dayLoad >= cfg.HEAVY_DAY_LOAD).map((day) => [day.date, day]));
  const occasions = input.pastWorkouts
    .filter((workout) => HARD_INTENSITY.has(workout.intensity))
    .flatMap((workout) => {
      const heavyDate = [...heavy.keys()].find((date) => {
        const dayStart = startOfLocalDay(date, input.timeZone);
        return dayStart > workout.start && dayStart <= workout.end + 24 * HOUR_MS;
      });
      if (heavyDate === undefined) return [];
      const next = input.nights.find((night) => night.date === heavyDate && night.hrvMean !== null);
      const before = input.nights.filter(
        (night) =>
          night.hrvMean !== null && night.date >= addLocalDays(heavyDate, -7) && night.date <= addLocalDays(heavyDate, -1),
      );
      if (next?.hrvMean == null || before.length === 0) return [];
      const baseline = before.reduce((total, night) => total + night.hrvMean!, 0) / before.length;
      if (baseline <= 0) return [];
      return [{ workout, dropPct: ((baseline - next.hrvMean) / baseline) * 100 }];
    })
    .sort((a, b) => b.workout.start - a.workout.start)
    .slice(0, 3)
    .sort((a, b) => a.workout.start - b.workout.start);
  if (occasions.length === 0) return fallback;
  const meanDrop = occasions.reduce((total, item) => total + item.dropPct, 0) / occasions.length;
  const verb = meanDrop < 0 ? 'rose' : 'dropped';
  const times = occasions.length === 1 ? 'The last time' : `The last ${occasions.length} times`;
  return {
    evidence: `${times} you did hard training before a heavy day, your HRV ${verb} about ${round0(Math.abs(meanDrop))}% the next night.`,
    evidenceRefs: occasions.map((item) => ({
      label: shortDate(localDate(item.workout.start, input.timeZone)),
      date: localDate(item.workout.start, input.timeZone),
    })),
  };
};

const trainingActions = (input: RecommendInput, cfg: EngineConfig): readonly Action[] => {
  const lastWeekDay = addLocalDays(input.today, 6);
  const byDate = new Map(input.days.map((day) => [day.date, day]));
  const heavyDates = input.days.filter((day) => dayLoadOf(day, cfg) >= cfg.HEAVY_DAY_LOAD).map((day) => day.date);
  const evidence = trainingEvidence(input, cfg);
  return input.days.flatMap((day) =>
    day.workouts.filter((workout) => HARD_INTENSITY.has(workout.intensity) && workout.end > input.now).flatMap((workout) => {
      const workoutDate = localDate(workout.start, input.timeZone);
      const qualifies = heavyDates.some((date) => {
        const dayStart = startOfLocalDay(date, input.timeZone);
        return workoutDate === date || (workout.start >= dayStart - 24 * HOUR_MS && workout.start < dayStart);
      });
      if (!qualifies) return [];
      const target = Array.from({ length: 7 }, (_, index) => addLocalDays(workoutDate, index + 1)).find((date) => {
        if (date > lastWeekDay) return false;
        const host = byDate.get(date);
        const load = host ? dayLoadOf(host, cfg, workout.id) : 0;
        return load < cfg.TRAINING_SWAP_TARGET_MAX_DAY_LOAD;
      });
      if (target === undefined) return [];
      const shift = startOfLocalDay(target, input.timeZone) - startOfLocalDay(workoutDate, input.timeZone);
      const when = workoutDate === input.today ? "today's" : workoutDate === input.tomorrow ? "tomorrow's" : `${weekdayName(workoutDate).toLowerCase()}'s`;
      return [
        action({
          id: `training_swap:${workout.id}`,
          rule: 'training_swap',
          title: `Move ${when} ${workout.intensity} to ${weekdayName(target)}`,
          evidence: evidence.evidence,
          evidenceRefs: evidence.evidenceRefs,
          impact: impactOf(input.tomorrowDayLoad, input.tomorrowGap),
          altersProjection: true,
          change: { kind: 'move_workout', workoutId: workout.id, start: workout.start + shift, end: workout.end + shift },
        }),
      ];
    }),
  );
};

const resetAction = (input: RecommendInput, cfg: EngineConfig): Action | null => {
  const horizon = startOfLocalDay(addLocalDays(input.tomorrow, 1), input.timeZone);
  const candidates = input.days
    .flatMap((day) => day.meetings)
    .filter((item) => item.meeting.start > input.now && item.meeting.start < horizon && item.load >= cfg.HEAVY_DAY_LOAD)
    .sort((a, b) => b.load - a.load || a.meeting.start - b.meeting.start);
  const chosen = candidates.find((item) => {
    const window = { start: item.meeting.start - BUFFER_SHIFT_MIN * MINUTE_MS, end: item.meeting.start };
    return input.days.every((day) => eventsOf(day).every((event) => event.id === item.meeting.id || !overlaps(event, window)));
  });
  if (chosen === undefined) return null;
  const history = input.pastMeetings
    .filter((item) => item.meeting.type === chosen.meeting.type)
    .sort((a, b) => b.meeting.start - a.meeting.start);
  const tails = history.map((item) => item.measured.recoveryTailMin).sort((a, b) => a - b);
  const medianTail = tails.length === 0 ? null : tails[(tails.length - 1) >> 1]!;
  const walkStart = chosen.meeting.start - BUFFER_SHIFT_MIN * MINUTE_MS;
  return action({
    id: `pre_meeting_reset:${chosen.meeting.id}`,
    rule: 'pre_meeting_reset',
    title: `10-minute walk at ${formatClock(walkStart, input.timeZone)} before the ${chosen.meeting.title}`,
    evidence:
      medianTail === null
        ? 'This meeting is predicted to be demanding, and you have no measured history for this type yet.'
        : `${capitalize(typePlural(chosen.meeting.type))} cost you a lot: your stress takes about ${medianTail} minutes to return to baseline afterwards.`,
    evidenceRefs: history.map((item) => ({ label: item.meeting.title, meetingId: item.meeting.id, link: 'meeting' as const })),
    impact: impactOf(chosen.load, input.tomorrowGap),
    altersProjection: false,
    change: {
      kind: 'add_block',
      title: '10-minute walk',
      start: walkStart,
      end: walkStart + WALK_MIN * MINUTE_MS,
      forDate: localDate(chosen.meeting.start, input.timeZone),
    },
  });
};

const bufferActions = (input: RecommendInput, cfg: EngineConfig): readonly Action[] => {
  const tomorrow = input.days.find((day) => day.date === input.tomorrow);
  if (tomorrow === undefined) return [];
  const hidden = new Map(input.energy.filter((entry) => entry.group === 'hidden_drain').map((entry) => [entry.person.id, entry]));
  return tomorrow.meetings.flatMap((item) => {
    const drains = item.meeting.attendeeIds
      .flatMap((id) => {
        const entry = hidden.get(id);
        return entry ? [entry] : [];
      })
      .sort((a, b) => b.bodyEffect - a.bodyEffect);
    const drain = drains[0];
    const backToBack = item.modifiers.backToBack && item.load >= 50;
    if (durationMin(item.meeting) > 60 || (!backToBack && drain === undefined)) return [];
    const previous = tomorrow.meetings
      .filter(
        (other) =>
          other.meeting.id !== item.meeting.id &&
          other.meeting.end <= item.meeting.start &&
          item.meeting.start - other.meeting.end <= cfg.BACK_TO_BACK_GAP_MIN * MINUTE_MS,
      )
      .sort((a, b) => b.meeting.end - a.meeting.end)[0];
    const personId = drain?.person.id ?? item.meeting.attendeeIds[0];
    const person = input.people.find((candidate) => candidate.id === personId);
    const name = firstName(person?.name ?? drain?.person.name ?? '');
    const withName = name.length > 0 && !item.meeting.title.includes(name) ? ` with ${name}` : '';
    const parts = [
      backToBack && previous ? `Back-to-back after the ${previous.meeting.title}` : null,
      drain ? `${typePlural(item.meeting.type)} with ${name} cost more than they feel (see Energy map)` : null,
    ].filter((part): part is string => part !== null);
    const movedStart = item.meeting.start + BUFFER_SHIFT_MIN * MINUTE_MS;
    return [
      action({
        id: `buffer_walking:${item.meeting.id}`,
        rule: 'buffer_walking',
        title: `Make the ${item.meeting.title}${withName} a ${durationMin(item.meeting)}-minute walking meeting at ${formatClock(movedStart, input.timeZone)}`,
        evidence: `${parts.join(', and ')}.`,
        evidenceRefs: [
          ...(backToBack && previous
            ? [{ label: previous.meeting.title, meetingId: previous.meeting.id, link: 'meeting' as const }]
            : []),
          ...(drain ? [{ label: 'Energy map', link: 'energy-map' as const }] : []),
        ],
        impact: impactOf(item.load, input.tomorrowGap),
        altersProjection: false,
        change: {
          kind: 'add_block',
          title: `Walking ${item.meeting.title}${withName}`,
          start: movedStart,
          end: item.meeting.end + BUFFER_SHIFT_MIN * MINUTE_MS,
          forDate: input.tomorrow,
        },
      }),
    ];
  });
};

const scanRecovery = (
  busy: readonly { start: EpochMs; end: EpochMs }[],
  windowStart: EpochMs,
  windowEnd: EpochMs,
): EpochMs | null => {
  let cursor = windowStart;
  for (const event of busy) {
    if (event.start - cursor >= RECOVERY_MIN * MINUTE_MS) return cursor;
    cursor = Math.max(cursor, event.end);
  }
  return windowEnd - cursor >= RECOVERY_MIN * MINUTE_MS ? cursor : null;
};

const recoveryActions = (input: RecommendInput, cfg: EngineConfig): readonly Action[] => {
  const byDate = new Map(input.days.map((day) => [day.date, day]));
  const lastDay = addLocalDays(input.today, 6);
  return input.days.flatMap((day) => {
    if (day.capacity === null) return [];
    const load = dayLoadOf(day, cfg);
    if (load - day.capacity < cfg.GAP_LEVELS.red) return [];
    const nextDate = addLocalDays(day.date, 1);
    const next = byDate.get(nextDate);
    if (next === undefined || nextDate > lastDay) return [];
    const slot = scanRecovery(
      eventsOf(next)
        .map((event) => ({
          start: Math.max(event.start, localDateTime(next.date, '09:00', input.timeZone)),
          end: Math.min(event.end, localDateTime(next.date, '17:00', input.timeZone)),
        }))
        .filter((event) => event.end > event.start)
        .sort((a, b) => a.start - b.start),
      localDateTime(next.date, '09:00', input.timeZone),
      localDateTime(next.date, '17:00', input.timeZone),
    );
    if (slot === null) return [];
    return [
      action({
        id: `recovery_block:${nextDate}`,
        rule: 'recovery_block',
        title: `Protect 30 minutes on ${weekdayName(nextDate)} at ${formatClock(slot, input.timeZone)}`,
        evidence: `The day before asks more than you had. Keep 30 minutes clear.`,
        impact: impactOf(load, input.tomorrowGap),
        altersProjection: false,
        change: {
          kind: 'add_block',
          title: 'Recovery block',
          start: slot,
          end: slot + RECOVERY_MIN * MINUTE_MS,
          forDate: nextDate,
        },
      }),
    ];
  });
};

/** Deterministic plan. Ordered by rule, then by impact. Nothing here is accepted yet. */
export const recommendActions = (input: RecommendInput, cfg: EngineConfig = ENGINE_CONFIG): readonly Action[] => {
  const reset = resetAction(input, cfg);
  const sleep = sleepAction(input, cfg);
  const actions = [
    ...(sleep ? [sleep] : []),
    ...trainingActions(input, cfg),
    ...(reset ? [reset] : []),
    ...bufferActions(input, cfg),
    ...recoveryActions(input, cfg),
  ];
  return [...actions].sort(
    (a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || b.impact - a.impact || a.id.localeCompare(b.id),
  );
};
