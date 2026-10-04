/**
 * Marta's calendar: 42 history days, an empty anchor day, and a future week whose tomorrow
 * is the heavy day from docs/happy-path.md. Placement is deterministic for a given seed.
 */
import type { CalendarFile, CalendarFileEvent } from '../../src/calendar/calendar-file';
import type { EpochMs, WorkoutIntensity } from '../../src/engine/types';
import { expectedLoad, meetingModifiers, type TimedMeeting } from './loads';
import {
  FUTURE_WEEKDAY_TEMPLATES,
  HISTORY_MEETING_GROUPS,
  PEOPLE,
  TOMORROW,
  WORKOUT_TITLES,
  type PersonaMeetingType,
  type PlannedEvent,
} from './persona.truth';
import type { Rng } from './prng';
import { dayLoad } from './testing/engine-mini';
import { addDays, isoWithOffset, localDateTime, localParts, MINUTE_MS, weekdayOf, type LocalDate } from './time';

export const PERSONA_TIME_ZONE = 'Europe/Warsaw';

export interface ScheduleAnchor {
  readonly today: LocalDate;
  readonly timeZone: string;
}

export interface ScheduledMeeting extends TimedMeeting {
  readonly id: string;
  readonly title: string;
  readonly date: LocalDate;
}

export interface ScheduledWorkout {
  readonly id: string;
  readonly title: string;
  readonly intensity: WorkoutIntensity;
  readonly start: EpochMs;
  readonly end: EpochMs;
  readonly date: LocalDate;
}

interface Draft {
  readonly key: string;
  readonly seq: number;
  readonly type: PersonaMeetingType;
  readonly title: string;
  readonly attendeeIds: readonly string[];
  readonly isGroup: boolean;
  readonly durationMin: number;
}

interface Placed extends Draft {
  readonly date: LocalDate;
  readonly startMin: number;
}

interface Run {
  readonly date: LocalDate;
  readonly intensity: WorkoutIntensity;
  readonly title: string;
}

const HISTORY_DAYS = 42;
const FUTURE_DAYS = 7;
const DAY_START = 9 * 60;
const DAY_END = 17 * 60 + 30;
const RUN_START = 18 * 60 + 30;
const RUN_END = 19 * 60 + 30;
const SLOT_STEP = 15;

const isWeekday = (date: LocalDate): boolean => weekdayOf(date) !== 0 && weekdayOf(date) !== 6;

const diffDays = (later: LocalDate, earlier: LocalDate): number =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);

const datesFrom = (start: LocalDate, count: number): readonly LocalDate[] =>
  Array.from({ length: count }, (_, index) => addDays(start, index));

const endMinOf = (meeting: Placed): number => meeting.startMin + meeting.durationMin;

const at = (meeting: Placed, timeZone: string): TimedMeeting => ({
  type: meeting.type,
  attendeeIds: meeting.attendeeIds,
  isGroup: meeting.isGroup,
  start: localDateTime(meeting.date, meeting.startMin, timeZone),
  end: localDateTime(meeting.date, endMinOf(meeting), timeZone),
});

const recoveryGapMin = (load: number): number => 0.5 * (load + 6) + 12;

const historyDrafts = (): Draft[] =>
  HISTORY_MEETING_GROUPS.flatMap((group) =>
    Array.from({ length: group.count }, (_, seq) => ({
      key: group.key,
      seq,
      type: group.type,
      title: group.title,
      attendeeIds: group.attendeeIds,
      isGroup: group.isGroup,
      durationMin: group.durationMin,
    })),
  );

const pull = (pool: Draft[], key: string): Draft => {
  const index = pool.findIndex((draft) => draft.key === key);
  const draft = pool[index];
  if (draft === undefined) throw new Error(`Persona schedule ran out of "${key}" meetings.`);
  pool.splice(index, 1);
  return draft;
};

const place = (draft: Draft, date: LocalDate, startMin: number): Placed => ({ ...draft, date, startMin });

const onDate = (meetings: readonly Placed[], date: LocalDate): Placed[] =>
  meetings.filter((meeting) => meeting.date === date).sort((a, b) => a.startMin - b.startMin);

/** Noise-free day load, same formula the schedule spec scores history with. */
const estimatedDayLoad = (
  meetings: readonly Placed[],
  intensity: WorkoutIntensity | undefined,
  timeZone: string,
): number => {
  const timed = meetings.map((meeting) => at(meeting, timeZone));
  return dayLoad(
    meetings.map((meeting, index) => ({
      load: expectedLoad(timed[index]!, meetingModifiers(timed[index]!, timed, timeZone)),
      durationH: meeting.durationMin / 60,
    })),
    intensity === undefined ? [] : [{ intensity }],
  );
};

const gapsFit = (meetings: readonly Placed[], timeZone: string): boolean => {
  const timed = meetings.map((meeting) => at(meeting, timeZone));
  return timed.every((meeting, index) => {
    const previous = timed[index - 1];
    const previousPlaced = meetings[index - 1];
    if (previous === undefined || previousPlaced === undefined) return true;
    const gapMin = (meeting.start - previous.end) / MINUTE_MS;
    if (gapMin < -1e-6) return false;
    if (gapMin <= 5) return previousPlaced.type === 'standup';
    const load = expectedLoad(previous, meetingModifiers(previous, timed, timeZone));
    return gapMin + 1e-6 >= recoveryGapMin(load);
  });
};

const overlaps = (meetings: readonly Placed[]): boolean =>
  meetings.some((meeting, index) => meetings.slice(index + 1).some((other) => meeting.startMin < endMinOf(other) && other.startMin < endMinOf(meeting)));

const canAdd = (
  placed: readonly Placed[],
  candidate: Placed,
  runs: ReadonlyMap<LocalDate, WorkoutIntensity>,
  timeZone: string,
  ceiling: number,
): boolean => {
  if (candidate.startMin < DAY_START || endMinOf(candidate) > DAY_END) return false;
  const day = [...onDate(placed, candidate.date), candidate].sort((a, b) => a.startMin - b.startMin);
  if (overlaps(day) || !gapsFit(day, timeZone)) return false;
  return estimatedDayLoad(day, runs.get(candidate.date), timeZone) < ceiling;
};

const pickBoards = (today: LocalDate, rng: Rng): readonly LocalDate[] => {
  const eligible = datesFrom(addDays(today, -35), 27).filter(isWeekday);
  const size = Math.ceil(eligible.length / 3);
  const chunks = [0, 1, 2].map((index) => eligible.slice(index * size, (index + 1) * size));
  const picked = chunks.reduce<LocalDate[]>((chosen, chunk) => {
    const open = chunk.filter((date) => chosen.every((other) => Math.abs(diffDays(date, other)) >= 2));
    const date = rng.pick(open);
    return [...chosen, date];
  }, []);
  return [...picked].sort();
};

const pickRuns = (historyStart: LocalDate, boardDates: readonly LocalDate[], rng: Rng): Map<LocalDate, WorkoutIntensity> => {
  const runs = new Map<LocalDate, WorkoutIntensity>(boardDates.map((date) => [addDays(date, -1), 'intervals']));
  const fillers = rng.shuffle([
    ...Array.from({ length: 8 }, (): WorkoutIntensity => 'easy'),
    ...Array.from({ length: 7 }, (): WorkoutIntensity => 'tempo'),
  ]);
  const boards = new Set(boardDates);
  const cursor = { index: 0 };
  const takeFiller = (): WorkoutIntensity => {
    const intensity = fillers[cursor.index];
    cursor.index += 1;
    if (intensity === undefined) throw new Error('Persona schedule ran out of easy/tempo runs.');
    return intensity;
  };
  return Array.from({ length: 6 }, (_, week) => addDays(historyStart, week * 7)).reduce((assigned, weekStart) => {
    const days = datesFrom(weekStart, 7);
    const open = rng.shuffle(days.filter((date) => !assigned.has(date) && !boards.has(date)));
    const ordered = open.includes(historyStart) ? [historyStart, ...open.filter((date) => date !== historyStart)] : open;
    const need = 3 - days.filter((date) => assigned.has(date)).length;
    if (need < 0 || ordered.length < need) throw new Error(`Week of ${weekStart} cannot hold exactly 3 runs.`);
    ordered.slice(0, need).forEach((date) => assigned.set(date, takeFiller()));
    return assigned;
  }, runs);
};

const slotStarts = (durationMin: number): readonly number[] => {
  const latest = DAY_END - durationMin;
  const first = 9 * 60 + 45;
  return Array.from({ length: Math.floor((latest - first) / SLOT_STEP) + 1 }, (_, index) => first + index * SLOT_STEP);
};

const placeGreedy = (
  pool: Draft[],
  placed: Placed[],
  runs: ReadonlyMap<LocalDate, WorkoutIntensity>,
  weekdays: readonly LocalDate[],
  blocked: ReadonlySet<LocalDate>,
  timeZone: string,
  rng: Rng,
): void => {
  const pending = [...pool].sort((a, b) => b.durationMin - a.durationMin || a.key.localeCompare(b.key) || a.seq - b.seq);
  pool.length = 0;
  pending.forEach((draft) => {
    const options = weekdays
      .filter((date) => !blocked.has(date))
      .flatMap((date) => slotStarts(draft.durationMin).map((startMin) => ({ date, startMin })))
      .filter(({ date, startMin }) => canAdd(placed, place(draft, date, startMin), runs, timeZone, 58))
      .map(({ date, startMin }) => ({
        date,
        startMin,
        score: estimatedDayLoad([...onDate(placed, date), place(draft, date, startMin)], runs.get(date), timeZone),
      }))
      .sort((a, b) => a.score - b.score || a.date.localeCompare(b.date) || a.startMin - b.startMin);
    const choice = options[0] === undefined ? undefined : rng.pick(options.slice(0, Math.min(4, options.length)));
    if (choice === undefined) {
      throw new Error(`No history slot left for ${draft.key} #${draft.seq} (${draft.durationMin} min).`);
    }
    placed.push(place(draft, choice.date, choice.startMin));
  });
};

const forceAt = (
  pool: Draft[],
  placed: Placed[],
  runs: ReadonlyMap<LocalDate, WorkoutIntensity>,
  key: string,
  dates: readonly LocalDate[],
  startMin: number,
  timeZone: string,
): void => {
  const draft = pull(pool, key);
  const date = dates.find((candidate) => canAdd(placed, place(draft, candidate, startMin), runs, timeZone, 58));
  if (date === undefined) throw new Error(`No day left for a fixed ${key} at ${startMin}.`);
  placed.push(place(draft, date, startMin));
};

const futureMeeting = (event: Extract<PlannedEvent, { kind: 'meeting' }>, date: LocalDate, seq: number): Placed => {
  const [startH, startM] = event.start.split(':').map(Number);
  const [endH, endM] = event.end.split(':').map(Number);
  return {
    key: 'future',
    seq,
    type: event.type,
    title: event.title,
    attendeeIds: event.attendeeIds,
    isGroup: event.isGroup,
    durationMin: (endH ?? 0) * 60 + (endM ?? 0) - ((startH ?? 0) * 60 + (startM ?? 0)),
    date,
    startMin: (startH ?? 0) * 60 + (startM ?? 0),
  };
};

const eventId = (meeting: Placed): string => `${meeting.key}-${meeting.seq}-${meeting.date}-${meeting.startMin}`;

const toCalendarMeeting = (meeting: Placed, timeZone: string): CalendarFileEvent => ({
  id: eventId(meeting),
  kind: 'meeting',
  title: meeting.title,
  type: meeting.type,
  start: isoWithOffset(localDateTime(meeting.date, meeting.startMin, timeZone), timeZone),
  end: isoWithOffset(localDateTime(meeting.date, endMinOf(meeting), timeZone), timeZone),
  attendeeIds: meeting.attendeeIds,
  isGroup: meeting.isGroup,
});

const toCalendarWorkout = (run: Run, timeZone: string): CalendarFileEvent => ({
  id: `run-${run.date}`,
  kind: 'workout',
  title: run.title,
  intensity: run.intensity,
  start: isoWithOffset(localDateTime(run.date, RUN_START, timeZone), timeZone),
  end: isoWithOffset(localDateTime(run.date, RUN_END, timeZone), timeZone),
});

export const buildSchedule = (anchor: ScheduleAnchor, rng: Rng): CalendarFile => {
  const { today, timeZone } = anchor;
  const historyStart = addDays(today, -HISTORY_DAYS);
  const historyDates = datesFrom(historyStart, HISTORY_DAYS);
  const weekdays = historyDates.filter(isWeekday);
  const pool = historyDrafts();
  const placed: Placed[] = [];
  const boardDates = pickBoards(today, rng);
  const runs = pickRuns(historyStart, boardDates, rng);
  const blocked = new Set(boardDates);

  weekdays.forEach((date) => placed.push(place(pull(pool, 'standup'), date, DAY_START)));
  boardDates.forEach((date) => {
    placed.push(place(pull(pool, 'board'), date, 10 * 60));
    placed.push(place(pull(pool, 'investor-anna'), date, 13 * 60 + 30));
  });
  (['one-on-one-ola', 'customer-tomasz', 'one-on-one-piotr'] as const).forEach((key, index) => {
    const date = boardDates[index];
    if (date === undefined) throw new Error('Expected 3 board days.');
    placed.push(place(pull(pool, key), date, 16 * 60 + 30));
  });

  const lastWeekday = datesFrom(addDays(today, -3), 3).findLast(isWeekday);
  if (lastWeekday === undefined) throw new Error(`No weekday before ${today}.`);
  placed.push(place(pull(pool, 'one-on-one-piotr'), lastWeekday, 16 * 60 + 30));
  const pending = placed.at(-1);
  if (pending === undefined) throw new Error('Pending check-in was not placed.');

  rng
    .shuffle(weekdays.filter((date) => !blocked.has(date)))
    .slice(0, 3)
    .forEach((date) => forceAt(pool, placed, runs, 'one-on-one-ola', [date], 9 * 60 + 15, timeZone));
  rng
    .shuffle(weekdays.filter((date) => !blocked.has(date) && !onDate(placed, date).some((meeting) => meeting.startMin === 16 * 60 + 30)))
    .slice(0, 2)
    .forEach((date) => {
      const index = pool.findIndex((draft) => draft.durationMin <= 60);
      const draft = pool[index];
      if (draft === undefined || !canAdd(placed, place(draft, date, 16 * 60 + 30), runs, timeZone, 58)) {
        throw new Error(`No late-start meeting fits on ${date}.`);
      }
      pool.splice(index, 1);
      placed.push(place(draft, date, 16 * 60 + 30));
    });

  placeGreedy(pool, placed, runs, weekdays, blocked, timeZone, rng);

  const tomorrow = addDays(today, 1);
  const futureMeetings: Placed[] = [];
  const futureRuns: Run[] = [];
  let futureSeq = 0;
  TOMORROW.forEach((event) => {
    if (event.kind === 'workout') futureRuns.push({ date: tomorrow, intensity: event.intensity, title: event.title });
    else futureMeetings.push(futureMeeting(event, tomorrow, futureSeq++));
  });
  datesFrom(addDays(today, 2), FUTURE_DAYS - 1).filter(isWeekday).forEach((date, index) => {
    const template = FUTURE_WEEKDAY_TEMPLATES[index % FUTURE_WEEKDAY_TEMPLATES.length];
    if (template === undefined) return;
    futureMeetings.push(
      futureMeeting(
        { kind: 'meeting', title: 'Standup', type: 'standup', start: '09:00', end: '09:15', attendeeIds: [], isGroup: true },
        date,
        futureSeq++,
      ),
    );
    template.forEach((event) => futureMeetings.push(futureMeeting(event, date, futureSeq++)));
  });

  boardDates.forEach((date) => {
    const load = estimatedDayLoad(onDate(placed, date), runs.get(date), timeZone);
    if (load < 71 || load > 77) throw new Error(`Board day ${date} estimated load ${load.toFixed(2)} is outside 71-77.`);
  });

  const reflections = HISTORY_MEETING_GROUPS.flatMap((group) => {
    if (group.reflections.length === 0) return [];
    const meetings = placed.filter(
      (meeting) => meeting.key === group.key && meeting.date >= historyStart && meeting.date < today && eventId(meeting) !== eventId(pending),
    );
    const ratings = rng.shuffle(group.reflections);
    if (ratings.length !== meetings.length) {
      throw new Error(`Reflection count for ${group.key}: expected ${meetings.length}, truth has ${ratings.length}.`);
    }
    return meetings.map((meeting, index) => ({ meetingId: eventId(meeting), rating: ratings[index]! }));
  });

  const historyRuns: Run[] = [...runs.entries()].map(([date, intensity]) => ({
    date,
    intensity,
    title: WORKOUT_TITLES[intensity],
  }));
  const events = [...placed, ...futureMeetings]
    .map((meeting) => toCalendarMeeting(meeting, timeZone))
    .concat([...historyRuns, ...futureRuns].map((run) => toCalendarWorkout(run, timeZone)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  return {
    userKey: 'marta',
    displayName: 'Marta',
    isSynthetic: true,
    timeZone,
    people: PEOPLE.map(({ id, name, role }) => ({ id, name, role })),
    events,
    reflections,
  };
};

const scheduledMeeting = (event: Extract<CalendarFileEvent, { kind: 'meeting' }>, timeZone: string): ScheduledMeeting => ({
  id: event.id,
  type: event.type as PersonaMeetingType,
  title: event.title,
  attendeeIds: event.attendeeIds,
  isGroup: event.isGroup,
  start: Date.parse(event.start),
  end: Date.parse(event.end),
  date: localParts(Date.parse(event.start), timeZone).date,
});

const scheduledWorkout = (event: Extract<CalendarFileEvent, { kind: 'workout' }>, timeZone: string): ScheduledWorkout => ({
  id: event.id,
  title: event.title,
  intensity: event.intensity,
  start: Date.parse(event.start),
  end: Date.parse(event.end),
  date: localParts(Date.parse(event.start), timeZone).date,
});

export const scheduledEvents = (
  calendar: CalendarFile,
  timeZone: string,
): { readonly meetings: readonly ScheduledMeeting[]; readonly workouts: readonly ScheduledWorkout[] } => ({
  meetings: calendar.events.flatMap((event) => (event.kind === 'meeting' ? [scheduledMeeting(event, timeZone)] : [])),
  workouts: calendar.events.flatMap((event) => (event.kind === 'workout' ? [scheduledWorkout(event, timeZone)] : [])),
});
