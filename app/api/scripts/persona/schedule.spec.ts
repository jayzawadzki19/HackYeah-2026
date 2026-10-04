import { describe, expect, test } from 'bun:test';
import type { CalendarFile } from '../../src/calendar/calendar-file';
import { expectedLoad, meetingModifiers } from './loads';
import { HISTORY_MEETING_GROUPS, MEETING_TYPES, MODIFIERS, PEOPLE, personById, TOMORROW } from './persona.truth';
import { createRng } from './prng';
import { buildSchedule, PERSONA_TIME_ZONE, scheduledEvents, type ScheduledMeeting } from './schedule';
import { dayLoad } from './testing/engine-mini';
import { addDays, DAY_MS, localDateTime, localParts, MINUTE_MS, weekdayOf, zoneOffset } from './time';

const TZ = PERSONA_TIME_ZONE;
const DEMO_TODAY = '2026-10-04';

const generate = (today: string, seed = 2026): CalendarFile => buildSchedule({ today, timeZone: TZ }, createRng(seed));

const isWeekday = (date: string): boolean => ![0, 6].includes(weekdayOf(date));
const minuteOf = (t: number): number => localParts(t, TZ).minuteOfDay;
const hhmmOf = (t: number): string => {
  const { hour, minute } = localParts(t, TZ);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const viewOf = (calendar: CalendarFile, today: string) => {
  const { meetings, workouts } = scheduledEvents(calendar, TZ);
  const historyStart = addDays(today, -42);
  const inHistory = (date: string) => date >= historyStart && date < today;
  const history = meetings.filter((m) => inHistory(m.date));
  const sameDay = (m: ScheduledMeeting) => meetings.filter((o) => o.date === m.date);
  const estimated = (m: ScheduledMeeting) => expectedLoad(m, meetingModifiers(m, sameDay(m), TZ));
  const estimatedDayLoad = (date: string, load: (m: ScheduledMeeting) => number = estimated) =>
    dayLoad(
      meetings.filter((m) => m.date === date).map((m) => ({ load: load(m), durationH: (m.end - m.start) / 3_600_000 })),
      workouts.filter((w) => w.date === date),
    );
  const boardDates = history.filter((m) => m.type === 'board').map((m) => m.date);
  return { meetings, workouts, history, historyStart, inHistory, sameDay, estimated, estimatedDayLoad, boardDates };
};

const ANCHORS = [
  ['demo day (Sunday)', DEMO_TODAY, 2026],
  ['history across the autumn DST change (Wednesday)', '2026-11-04', 7],
  ['history across the spring DST change (Tuesday)', '2026-04-07', 99],
  ['Friday anchor', '2026-10-09', 1],
] as const;

describe.each(ANCHORS)('buildSchedule invariants - %s', (_label, today, seed) => {
  const calendar = generate(today, seed);
  const view = viewOf(calendar, today);

  test('persona metadata', () => {
    expect(calendar).toMatchObject({ userKey: 'marta', displayName: 'Marta', isSynthetic: true, timeZone: TZ });
  });

  test('covers 42 history days and 7 future days, nothing on today', () => {
    const dates = [...view.meetings, ...view.workouts].map((e) => e.date);
    expect(dates.every((d) => d >= view.historyStart && d <= addDays(today, 7))).toBe(true);
    expect(dates).not.toContain(today);
    expect(dates).toContain(view.historyStart);
  });

  test('history meeting counts per type match the truth table exactly', () => {
    Object.entries(MEETING_TYPES).forEach(([type, truth]) =>
      expect(view.history.filter((m) => m.type === type)).toHaveLength(truth.historyCount),
    );
  });

  test('history meeting counts per person match the truth table exactly', () => {
    PEOPLE.forEach((person) => {
      const expected = HISTORY_MEETING_GROUPS.filter((g) => g.attendeeIds.includes(person.id)).reduce(
        (sum, g) => sum + g.count,
        0,
      );
      expect(view.history.filter((m) => !m.isGroup && m.attendeeIds.includes(person.id))).toHaveLength(expected);
    });
  });

  test('21 people have 1-2 past meetings (below the scoring threshold)', () => {
    const counts = calendar.people.map(
      (p) => view.history.filter((m) => !m.isGroup && m.attendeeIds.includes(p.id)).length,
    );
    expect(counts.filter((c) => c >= 1 && c <= 2)).toHaveLength(21);
  });

  test('attendee sets per meeting group', () => {
    const attendeesOf = (title: string) => view.history.filter((m) => m.title === title).map((m) => m.attendeeIds);
    expect(new Set(attendeesOf('Board meeting').map((a) => a.join()))).toEqual(
      new Set(['anna-kowalska,kasia-wojcik,piotr-nowak']),
    );
    expect(new Set(attendeesOf('Product review').map((a) => a.join()))).toEqual(
      new Set(['ola-wisniewska,piotr-nowak']),
    );
    const investorAttendees = view.history.filter((m) => m.type === 'investor').map((m) => m.attendeeIds.join());
    expect(investorAttendees.filter((a) => a === 'anna-kowalska')).toHaveLength(3);
    expect(new Set(investorAttendees.filter((a) => a !== 'anna-kowalska')).size).toBe(5);
  });

  test('one standup 09:00-09:15 on every history weekday, as a group event without attendees', () => {
    const standups = view.history.filter((m) => m.type === 'standup');
    const weekdays = Array.from({ length: 42 }, (_, i) => addDays(view.historyStart, i)).filter(isWeekday);
    expect(standups.map((s) => s.date)).toEqual(weekdays);
    standups.forEach((s) => {
      expect([hhmmOf(s.start), hhmmOf(s.end), s.isGroup, s.attendeeIds]).toEqual(['09:00', '09:15', true, []]);
    });
  });

  test('history meetings happen on weekdays only, between 09:00 and 17:30', () => {
    view.history.forEach((m) => {
      expect(isWeekday(m.date)).toBe(true);
      expect(minuteOf(m.start)).toBeGreaterThanOrEqual(9 * 60);
      expect(minuteOf(m.end)).toBeLessThanOrEqual(17 * 60 + 30);
    });
  });

  test('no two events overlap', () => {
    const events = [...view.meetings, ...view.workouts].sort((a, b) => a.start - b.start);
    events.slice(1).forEach((e, i) => expect(e.start).toBeGreaterThanOrEqual(events[i]?.end ?? 0));
  });

  test('history meetings leave room for the previous recovery tail, unless back-to-back after the standup', () => {
    view.history
      .filter((m) => m.type !== 'standup')
      .forEach((m) => {
        const previous = view
          .sameDay(m)
          .filter((o) => o.end <= m.start)
          .sort((a, b) => b.end - a.end)[0];
        if (!previous) return;
        const gapMin = (m.start - previous.end) / MINUTE_MS;
        if (gapMin <= 5) expect(previous.type).toBe('standup');
        else expect(gapMin).toBeGreaterThanOrEqual(0.5 * (view.estimated(previous) + 6) + 12);
      });
  });

  test('modifiers are identifiable: some back-to-back and some late starts in history', () => {
    const modifiers = view.history.map((m) => meetingModifiers(m, view.sameDay(m), TZ));
    expect(modifiers.filter((m) => m.backToBack).length).toBeGreaterThanOrEqual(3);
    expect(modifiers.filter((m) => m.lateStart).length).toBeGreaterThanOrEqual(5);
  });

  test('3 history board days, 10:00-12:00 on weekdays, the earliest with 7 nights of history before it', () => {
    const boards = view.history.filter((m) => m.type === 'board');
    expect(boards).toHaveLength(3);
    boards.forEach((b) => expect([isWeekday(b.date), hhmmOf(b.start), hhmmOf(b.end)]).toEqual([true, '10:00', '12:00']));
    expect(view.boardDates[0]! >= addDays(today, -35)).toBe(true);
  });

  test('board days have an estimated day load of 71-77, every other history day below 58', () => {
    Array.from({ length: 42 }, (_, i) => addDays(view.historyStart, i)).forEach((date) => {
      const load = view.estimatedDayLoad(date);
      if (view.boardDates.includes(date)) {
        expect(load).toBeGreaterThanOrEqual(71);
        expect(load).toBeLessThanOrEqual(77);
      } else expect(load).toBeLessThan(58);
    });
  });

  test('runs are 18:30-19:30, three per week of history, mixing easy, tempo and intervals', () => {
    view.workouts.forEach((w) => expect([hhmmOf(w.start), hhmmOf(w.end)]).toEqual(['18:30', '19:30']));
    const historyRuns = view.workouts.filter((w) => view.inHistory(w.date));
    Array.from({ length: 6 }, (_, week) => addDays(view.historyStart, week * 7)).forEach((weekStart) =>
      expect(historyRuns.filter((w) => w.date >= weekStart && w.date < addDays(weekStart, 7))).toHaveLength(3),
    );
    expect(new Set(historyRuns.map((w) => w.intensity))).toEqual(new Set(['easy', 'tempo', 'intervals']));
  });

  test('exactly 3 hard runs the evening before a heavy day: intervals, one per board day, none on board days', () => {
    const heavyStarts = view.boardDates.map((d) => localDateTime(d, 0, TZ));
    const hardBeforeHeavy = view.workouts.filter(
      (w) =>
        view.inHistory(w.date) &&
        ['intervals', 'tempo'].includes(w.intensity) &&
        heavyStarts.some((start) => w.start < start && start - w.start <= DAY_MS),
    );
    expect(hardBeforeHeavy.map((w) => [w.date, w.intensity])).toEqual(
      view.boardDates.map((d) => [addDays(d, -1), 'intervals']),
    );
    expect(view.workouts.filter((w) => view.boardDates.includes(w.date))).toEqual([]);
  });

  test("tomorrow is exactly Marta's heavy day from the happy path", () => {
    const tomorrow = addDays(today, 1);
    const events = [
      ...view.meetings.filter((m) => m.date === tomorrow).map((m) => ['meeting', m.title, m.start, m.end] as const),
      ...view.workouts.filter((w) => w.date === tomorrow).map((w) => ['workout', w.title, w.start, w.end] as const),
    ]
      .sort((a, b) => a[2] - b[2])
      .map(([kind, title, start, end]) => [kind, title, hhmmOf(start), hhmmOf(end)]);
    expect(events).toEqual(TOMORROW.map((e) => [e.kind, e.title, e.start, e.end]));
    expect(view.meetings.filter((m) => m.date === tomorrow).map((m) => [m.type, m.attendeeIds, m.isGroup])).toEqual(
      TOMORROW.flatMap((e) => (e.kind === 'meeting' ? [[e.type, e.attendeeIds, e.isGroup]] : [])),
    );
    expect(view.workouts.find((w) => w.date === tomorrow)?.intensity).toBe('intervals');
  });

  test('the rest of the future week: no weekend meetings, weekdays with predicted day loads of 35-55', () => {
    const future = Array.from({ length: 6 }, (_, i) => addDays(today, i + 2));
    const priorOnly = (m: ScheduledMeeting) => {
      const { backToBack, lateStart } = meetingModifiers(m, view.sameDay(m), TZ);
      return MEETING_TYPES[m.type].prior + (backToBack ? MODIFIERS.backToBack : 0) + (lateStart ? MODIFIERS.lateStart : 0);
    };
    future.forEach((date) => {
      const meetings = view.meetings.filter((m) => m.date === date);
      if (!isWeekday(date)) expect(meetings).toEqual([]);
      else {
        [view.estimatedDayLoad(date), view.estimatedDayLoad(date, priorOnly)].forEach((load) => {
          expect(load).toBeGreaterThanOrEqual(35);
          expect(load).toBeLessThanOrEqual(55);
        });
      }
    });
  });

  test('no workout today or on the coming Saturday (the training swap target)', () => {
    const future = Array.from({ length: 6 }, (_, i) => addDays(today, i + 2));
    expect(view.workouts.filter((w) => future.includes(w.date) && weekdayOf(w.date) === 6)).toEqual([]);
    expect(view.workouts.filter((w) => w.date === today)).toEqual([]);
  });

  test('pending check-in: the most recent weekday ends with an unreflected 1:1 with Piotr at 16:30-17:00', () => {
    const lastWeekday = Array.from({ length: 7 }, (_, i) => addDays(today, -1 - i)).find(isWeekday) ?? '';
    const last = view.meetings.filter((m) => m.date === lastWeekday).sort((a, b) => b.start - a.start)[0];
    expect(last && [last.title, last.attendeeIds, hhmmOf(last.start), hhmmOf(last.end)]).toEqual([
      '1:1 with Piotr',
      ['piotr-nowak'],
      '16:30',
      '17:00',
    ]);
    expect(calendar.reflections.map((r) => r.meetingId)).not.toContain(last?.id);
  });

  test('reflections follow the per-group multisets, only for past meetings with a scored attendee', () => {
    const byId = new Map(view.meetings.map((m) => [m.id, m]));
    calendar.reflections.forEach((r) => {
      const m = byId.get(r.meetingId);
      expect(m && view.inHistory(m.date)).toBe(true);
      expect(m?.attendeeIds.some((id) => personById(id)?.kind === 'scored')).toBe(true);
    });
    HISTORY_MEETING_GROUPS.forEach((g) => {
      const ratings = calendar.reflections
        .filter((r) => {
          const m = byId.get(r.meetingId);
          return m?.title === g.title && m.attendeeIds.join() === g.attendeeIds.join();
        })
        .map((r) => r.rating)
        .sort();
      expect(ratings).toEqual([...g.reflections].sort());
    });
  });

  test('ids are unique, attendees are known people, timestamps carry the zone offset', () => {
    const ids = calendar.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const peopleIds = new Set(calendar.people.map((p) => p.id));
    view.meetings.forEach((m) => m.attendeeIds.forEach((id) => expect(peopleIds.has(id)).toBe(true)));
    calendar.events.forEach((e) => {
      expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
      expect(e.start.slice(19)).toBe(zoneOffset(Date.parse(e.start), TZ));
    });
  });
});

describe('buildSchedule determinism', () => {
  test('same seed and anchor give byte-identical calendars', () => {
    expect(JSON.stringify(generate(DEMO_TODAY))).toBe(JSON.stringify(generate(DEMO_TODAY)));
  });

  test('a different seed gives a different history', () => {
    const first = JSON.stringify(generate(DEMO_TODAY, 1));
    const second = JSON.stringify(generate(DEMO_TODAY, 2));
    expect(first === second).toBe(false);
  });

  test('people come straight from the truth file', () => {
    expect(generate(DEMO_TODAY).people).toEqual(PEOPLE.map(({ id, name, role }) => ({ id, name, role })));
  });
});

describe('scheduledEvents', () => {
  test('round-trips the calendar events to epoch times and local dates', () => {
    const calendar = generate(DEMO_TODAY);
    const { meetings, workouts } = scheduledEvents(calendar, TZ);
    expect(meetings.length + workouts.length).toBe(calendar.events.length);
    const board = meetings.find((m) => m.date === '2026-10-05' && m.type === 'board');
    expect(board?.start).toBe(Date.parse('2026-10-05T08:00:00Z'));
  });
});
