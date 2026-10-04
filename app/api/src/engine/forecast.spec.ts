import { describe, expect, test } from 'bun:test';
import { buildForecast, meetingTrace, pendingCheckIns, reflectionMessage, type ForecastInput } from './forecast';
import { at, meeting, WARSAW, workout, healthWith } from './testing/builders';
import { addLocalDays } from './time';
import type { EngineEvent, HealthData, SleepSession } from './types';

const TODAY = '2026-10-04';
const TOMORROW = '2026-10-05';
const NOW = at(TODAY, '11:00');

const night = (date: string, asleepMin: number): SleepSession => ({
  start: at(addLocalDays(date, -1), '23:00'),
  end: at(date, '06:30'),
  asleepMin,
});

const sleepsEnding = (days: number, asleepMin: number): SleepSession[] =>
  Array.from({ length: days }, (_, index) => night(addLocalDays(TODAY, -index), asleepMin));

const input = (events: readonly EngineEvent[], health: HealthData = healthWith({}), accepted: ForecastInput['accepted'] = []): ForecastInput => ({
  now: NOW,
  timeZone: WARSAW,
  events,
  people: [
    { id: 'piotr', name: 'Piotr Nowak', role: 'Co-founder' },
    { id: 'anna', name: 'Anna Kowalska', role: 'Lead investor' },
  ],
  health,
  reflections: [],
  accepted,
});

describe('buildForecast', () => {
  test('an empty calendar still returns seven days and does not invent capacity', () => {
    const result = buildForecast(input([]));

    expect(result.computedAt).toBe(NOW);
    expect(result.headline).toBe('You have headroom for tomorrow.');
    expect(result.capacityNow.score).toBeNull();
    expect(result.outlook).toEqual({ capacity: null, dayLoad: 0, gap: null, gapLevel: null });
    expect(result.projected).toBeNull();
    expect(result.tomorrow).toMatchObject({ date: TOMORROW, dayLoad: 0, heaviestInDays: null, meetings: [], workouts: [] });
    expect(result.week.map((day) => day.date)).toEqual(Array.from({ length: 7 }, (_, index) => addLocalDays(TODAY, index)));
    expect(result.week.every((day) => day.blocks.length === 0 && day.dayLoad === 0)).toBe(true);
    expect(result.actions).toEqual([]);
    expect(result.upcoming).toEqual([]);
    expect(result.measured.size).toBe(0);
    expect(result.energyMap).toEqual({ entries: [], belowThresholdCount: 0 });
    expect(result.model.typeEffects.board).toBe(70);
  });

  test('calls tomorrow the heaviest day in 6 weeks when it beats every history day', () => {
    const board = meeting({
      id: 'board',
      title: 'Board meeting',
      type: 'board',
      isGroup: true,
      start: at(TOMORROW, '10:00'),
      end: at(TOMORROW, '14:00'),
    });
    const result = buildForecast(input([board]));

    expect(result.headline).toBe('Tomorrow is your heaviest day in 6 weeks.');
    expect(result.tomorrow.heaviestInDays).toBe(42);
    expect(result.tomorrow.dayLoad).toBe(70);
    expect(result.tomorrow.meetings[0]).toMatchObject({
      load: 70,
      label: 'Population default - no history yet',
      modifiers: { backToBack: false, lateStart: false },
    });
    expect(result.upcoming.map((item) => item.meeting.id)).toEqual(['board']);
  });

  test('names a demanding meeting when tomorrow is not the heaviest day', () => {
    const events = [
      workout({ id: 'old-run', intensity: 'intervals', start: at('2026-10-01', '18:30'), end: at('2026-10-01', '19:30') }),
      meeting({
        id: 'board',
        title: 'Board meeting',
        type: 'board',
        isGroup: true,
        start: at(TOMORROW, '10:00'),
        end: at(TOMORROW, '10:15'),
      }),
      meeting({
        id: 'later',
        title: 'Later board',
        type: 'board',
        isGroup: true,
        start: at('2026-10-06', '10:00'),
        end: at('2026-10-06', '11:00'),
      }),
    ];
    const result = buildForecast(input(events));

    expect(result.headline).toBe('Board meeting at 10:00 will be demanding. Protect your headroom before it.');
    expect(result.tomorrow.heaviestInDays).toBeNull();
    expect(result.upcoming.map((item) => item.meeting.id)).toEqual(['board']);
    expect(result.week.find((day) => day.date === '2026-10-06')!.meetings.map((item) => item.meeting.id)).toEqual(['later']);
  });

  test('says tomorrow asks more than you have when the gap is amber and nothing else dominates', () => {
    const health = healthWith({ sleeps: sleepsEnding(7, 180) });
    const events = [
      meeting({
        id: 'history',
        title: 'Review',
        type: 'product_review',
        isGroup: true,
        start: at('2026-10-01', '10:00'),
        end: at('2026-10-01', '17:00'),
      }),
      meeting({
        id: 'tomorrow',
        title: 'Review',
        type: 'product_review',
        isGroup: true,
        start: at(TOMORROW, '10:00'),
        end: at(TOMORROW, '15:00'),
      }),
    ];
    const result = buildForecast(input(events, health));

    expect(result.capacityNow.score).toBe(40);
    expect(result.outlook).toEqual({ capacity: 40, dayLoad: 50, gap: 10, gapLevel: 'amber' });
    expect(result.headline).toBe('Tomorrow asks more than you have in the tank.');
    expect(result.tomorrow.heaviestInDays).toBeNull();
    expect(result.measured.get('history')?.kind).toBe('insufficient');
  });

  test('keeps outlook fixed and applies accepted sleep and training to the projection and the week', () => {
    const health = healthWith({ sleeps: sleepsEnding(14, 365) });
    const board = meeting({
      id: 'board',
      title: 'Board meeting',
      type: 'board',
      isGroup: true,
      start: at(TOMORROW, '10:00'),
      end: at(TOMORROW, '14:00'),
    });
    const intervals = workout({
      id: 'intervals',
      title: 'Run: intervals',
      intensity: 'intervals',
      start: at(TOMORROW, '18:30'),
      end: at(TOMORROW, '19:30'),
    });
    const base = buildForecast(input([board, intervals], health));
    const sleep = base.actions.find((action) => action.rule === 'sleep_target')!;
    const swap = base.actions.find((action) => action.rule === 'training_swap')!;
    const reset = base.actions.find((action) => action.rule === 'pre_meeting_reset')!;
    const projected = buildForecast(
      input(
        [board, intervals],
        health,
        [
          { actionId: sleep.id, change: sleep.change },
          { actionId: swap.id, change: swap.change },
        ],
      ),
    );

    expect(base.outlook).toEqual({ capacity: 81, dayLoad: 78, gap: -3, gapLevel: 'green' });
    expect(base.projected).toBeNull();
    expect(sleep).toMatchObject({
      id: 'sleep_target:2026-10-05',
      title: 'Lights out by 22:45',
      evidence: 'You usually wake at 06:30. 7h30 of sleep before a Monday this heavy means lights out by 22:45.',
      accepted: false,
    });
    expect(swap.title).toBe("Move tomorrow's intervals to Tuesday");
    expect(swap.evidence).toBe('Hard training the evening before a heavy day adds load when you have the least headroom.');
    expect(reset.title).toBe('10-minute walk at 09:45 before the Board meeting');
    expect(projected.outlook).toEqual(base.outlook);
    expect(projected.projected).toEqual({ capacity: 100, dayLoad: 70, gap: -30, gapLevel: 'green' });
    expect(projected.tomorrow.dayLoad).toBe(70);
    expect(projected.tomorrow.workouts).toEqual([]);
    expect(projected.tomorrow.heaviestInDays).toBe(42);
    expect(projected.headline).toBe('Tomorrow is your heaviest day in 6 weeks.');
    expect(projected.actions.find((action) => action.id === sleep.id)!.accepted).toBe(true);
    expect(projected.actions.find((action) => action.id === swap.id)!.accepted).toBe(true);
    expect(projected.actions.find((action) => action.id === reset.id)!.accepted).toBe(false);
    const tuesday = projected.week.find((day) => day.date === '2026-10-06')!;
    expect(tuesday.workouts).toEqual([{ ...intervals, start: at('2026-10-06', '18:30'), end: at('2026-10-06', '19:30'), movedByHeadroom: true }]);
    expect(tuesday.dayLoad).toBe(8);
    const monday = projected.week.find((day) => day.date === TOMORROW)!;
    expect(monday.blocks.map((block) => block.title)).toEqual(['Lights out 22:45']);
    expect(monday.dayLoad).toBe(70);
    expect(projected.week.reduce((count, day) => count + day.blocks.length, 0)).toBe(1);
  });

  test('marks back-to-back and late-start modifiers from the same-day schedule', () => {
    const events = [
      meeting({ id: 'standup', type: 'standup', isGroup: true, start: at(TOMORROW, '09:00'), end: at(TOMORROW, '09:15') }),
      meeting({ id: 'board', type: 'board', isGroup: true, start: at(TOMORROW, '09:15'), end: at(TOMORROW, '10:15') }),
      meeting({ id: 'late', type: 'customer', isGroup: true, start: at(TOMORROW, '16:30'), end: at(TOMORROW, '17:00') }),
    ];
    const byId = new Map(buildForecast(input(events)).tomorrow.meetings.map((item) => [item.meeting.id, item.modifiers]));

    expect(byId.get('standup')).toEqual({ backToBack: false, lateStart: false });
    expect(byId.get('board')).toEqual({ backToBack: true, lateStart: false });
    expect(byId.get('late')).toEqual({ backToBack: false, lateStart: true });
  });

  test('uses a measured load for a meeting that already ended and keeps every load inside 0-100', () => {
    const past = meeting({ id: 'past', type: 'board', isGroup: true, start: at(TODAY, '08:00'), end: at(TODAY, '09:00') });
    const result = buildForecast(input([past]));
    const shown = result.week[0]!.meetings[0]!;

    expect(result.measured.get('past')?.kind).toBe('insufficient');
    expect(shown.load).toBe(70);
    expect(result.upcoming).toEqual([]);
    expect(result.week.every((day) => day.dayLoad >= 0 && day.dayLoad <= 100)).toBe(true);
    expect(result.capacityNow.score === null || (result.capacityNow.score >= 0 && result.capacityNow.score <= 100)).toBe(true);
  });

  test('builds a 42-day forecast over about 20k stress samples well under a second', () => {
    const origin = at('2026-08-23', '00:00');
    const stress = Array.from({ length: 20_160 }, (_, index) => ({ t: origin + index * 3 * 60_000, v: 25 + (index % 7) }));
    const events = Array.from({ length: 42 }, (_, index) => {
      const date = addLocalDays(TODAY, -42 + index);
      return meeting({
        id: `m-${date}`,
        type: index % 2 === 0 ? 'one_on_one' : 'board',
        start: at(date, '10:00'),
        end: at(date, '11:00'),
        attendeeIds: ['piotr'],
      });
    });
    const forecastInput = input(events, healthWith({ stress, sleeps: sleepsEnding(14, 400) }));
    buildForecast(forecastInput);
    const started = performance.now();
    const result = buildForecast(forecastInput);
    const elapsed = performance.now() - started;

    expect(result.measured.size).toBe(42);
    expect(result.baseline.stressByHour).toHaveLength(24);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('pendingCheckIns', () => {
  const recent = meeting({
    id: 'recent',
    title: '1:1 with Piotr',
    start: at(TODAY, '09:00'),
    end: at(TODAY, '09:30'),
    attendeeIds: ['piotr'],
  });
  const older = meeting({
    id: 'older',
    title: '1:1',
    start: at('2026-10-02', '16:30'),
    end: at('2026-10-02', '17:00'),
    attendeeIds: ['anna'],
  });

  test('returns past non-group meetings with an attendee from the last 7 days, newest first', () => {
    const events = [
      older,
      recent,
      meeting({ id: 'group', isGroup: true, start: at(TODAY, '08:00'), end: at(TODAY, '08:30'), attendeeIds: ['piotr'] }),
      meeting({ id: 'nobody', start: at(TODAY, '07:00'), end: at(TODAY, '07:30'), attendeeIds: [] }),
      meeting({
        id: 'stale',
        start: at('2026-09-26', '10:00'),
        end: at('2026-09-26', '11:00'),
        attendeeIds: ['piotr'],
      }),
      meeting({ id: 'future', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00'), attendeeIds: ['piotr'] }),
    ];

    expect(pendingCheckIns(events, [], NOW, WARSAW).map((item) => item.id)).toEqual(['recent', 'older']);
    expect(pendingCheckIns(events, [{ meetingId: 'recent', rating: 1 }], NOW, WARSAW).map((item) => item.id)).toEqual(['older']);
  });
});

describe('reflectionMessage', () => {
  const ok = (excessStress: number) =>
    ({
      kind: 'ok' as const,
      value: { load: 50, excessStress, recoveryTailMin: 10, validSamples: 8, signal: 'stress' as const, recoveredAt: null },
    });

  test('disagrees when you felt fine and stress stayed high, rounding excess to 5', () => {
    expect(reflectionMessage(1, ok(22))).toBe(
      'You felt energized. Your body disagreed: stress was about 20 points above your baseline.',
    );
    expect(reflectionMessage(0, ok(12.5))).toBe(
      'You felt neutral. Your body disagreed: stress was about 15 points above your baseline.',
    );
  });

  test('disagrees the other way when you felt drained and your body was calm', () => {
    expect(reflectionMessage(-1, ok(4.9))).toBe('You felt drained, but your body stayed calm.');
  });

  test('agrees otherwise, including when the meeting could not be measured', () => {
    expect(reflectionMessage(-1, ok(12))).toBe('You felt drained. Your body agreed.');
    expect(reflectionMessage(1, ok(9))).toBe('You felt energized. Your body agreed.');
    expect(reflectionMessage(1, undefined)).toBe('You felt energized.');
    expect(reflectionMessage(0, { kind: 'insufficient', reason: 'no_samples', detail: 'none' })).toBe('You felt neutral.');
  });
});

describe('meetingTrace export', () => {
  test('is the same trace the meeting view reads', () => {
    const board = meeting({ start: at(TODAY, '10:00'), end: at(TODAY, '11:00') });
    expect(meetingTrace(board, healthWith({}), { stressByHour: Array(24).fill(25), hrByHour: Array(24).fill(68) }, WARSAW)).toEqual([]);
  });
});
