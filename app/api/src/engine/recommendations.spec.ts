import { describe, expect, test } from 'bun:test';
import { dayLoad } from './day-load';
import { ENGINE_CONFIG } from './engine.config';
import type { EnergyEntry } from './energy-map';
import type { Night } from './nights';
import { recommendActions, type ScoredMeeting } from './recommendations';
import { at, meeting, WARSAW, workout } from './testing/builders';
import type { EngineMeeting, EngineWorkout } from './types';

const TODAY = '2026-10-04';
const TOMORROW = '2026-10-05';
const NOW = at(TODAY, '11:00');

const scored = (
  partial: Partial<EngineMeeting> & Pick<EngineMeeting, 'start' | 'end'>,
  load: number,
  modifiers: ScoredMeeting['modifiers'] = { backToBack: false, lateStart: false },
): ScoredMeeting => ({
  meeting: meeting(partial),
  load,
  modifiers,
});

const hours = (event: { start: number; end: number }): number => (event.end - event.start) / 3_600_000;

const loadOf = (meetings: readonly ScoredMeeting[], workouts: readonly EngineWorkout[]): number =>
  dayLoad(
    meetings.map((item) => ({ load: item.load, durationH: hours(item.meeting) })),
    workouts,
    ENGINE_CONFIG,
  );

const energy = (id: string, name: string, group: EnergyEntry['group'], bodyEffect: number): EnergyEntry => ({
  person: { id, name, role: null },
  meetings: 6,
  bodyEffect,
  felt: group === 'hidden_drain' ? 0 : null,
  reflections: 4,
  group,
  confidence: 'high',
  explanation: '',
});

const measured = (recoveryTailMin: number) => ({
  load: 80,
  excessStress: 30,
  recoveryTailMin,
  validSamples: 10,
  signal: 'stress' as const,
  recoveredAt: null,
});

const night = (date: string, hrv: number): Night => ({
  date,
  session: { start: at(date, '00:00') - 60 * 60_000, end: at(date, '06:30'), asleepMin: 360 },
  hrvMean: hrv,
});

describe('recommendActions', () => {
  test('orders sleep, training, reset, buffer, recovery, and by impact inside a rule', () => {
    const board = scored(
      { id: 'board', title: 'Board meeting', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '12:00') },
      90,
    );
    const oneOnOne = scored(
      {
        id: 'piotr-1on1',
        title: '1:1',
        type: 'one_on_one',
        start: at(TOMORROW, '12:00'),
        end: at(TOMORROW, '12:30'),
        attendeeIds: ['piotr'],
      },
      56,
      { backToBack: true, lateStart: false },
    );
    const investor = scored(
      { id: 'investor', title: 'Investor call', type: 'investor', start: at(TOMORROW, '14:00'), end: at(TOMORROW, '15:00') },
      40,
    );
    const intervals = workout({
      id: 'intervals',
      title: 'Run: intervals 6 x 800 m',
      intensity: 'intervals',
      start: at(TOMORROW, '18:30'),
      end: at(TOMORROW, '19:30'),
    });
    const monday = [board, oneOnOne, investor];
    const busy = (date: string) => [
      scored({ id: `busy-${date}`, title: 'Review', type: 'product_review', start: at(date, '09:00'), end: at(date, '12:00') }, 80),
    ];
    const tuesday = busy('2026-10-06');
    const week = [
      { date: TODAY, meetings: [], workouts: [], capacity: 40 },
      { date: TOMORROW, meetings: monday, workouts: [intervals], capacity: 40 },
      { date: '2026-10-06', meetings: tuesday, workouts: [], capacity: 90 },
      { date: '2026-10-07', meetings: busy('2026-10-07'), workouts: [], capacity: 90 },
      { date: '2026-10-08', meetings: busy('2026-10-08'), workouts: [], capacity: 90 },
      { date: '2026-10-09', meetings: busy('2026-10-09'), workouts: [], capacity: 90 },
      { date: '2026-10-10', meetings: [], workouts: [], capacity: 90 },
    ];
    const tomorrowDayLoad = loadOf(monday, [intervals]);
    const gap = tomorrowDayLoad - 40;
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad,
        tomorrowGap: gap,
        medianWakeMinutes14d: 6 * 60 + 30,
        days: week,
        people: [{ id: 'piotr', name: 'Piotr Nowak', role: 'Co-founder' }],
        energy: [energy('piotr', 'Piotr Nowak', 'hidden_drain', 12)],
        pastMeetings: [
          {
            meeting: meeting({
              id: 'b-old',
              title: 'Board meeting',
              type: 'board',
              start: at('2026-09-07', '10:00'),
              end: at('2026-09-07', '12:00'),
            }),
            measured: measured(30),
          },
          {
            meeting: meeting({
              id: 'b-mid',
              title: 'Board meeting',
              type: 'board',
              start: at('2026-09-21', '10:00'),
              end: at('2026-09-21', '12:00'),
            }),
            measured: measured(45),
          },
          {
            meeting: meeting({
              id: 'b-new',
              title: 'Board meeting',
              type: 'board',
              start: at('2026-09-28', '10:00'),
              end: at('2026-09-28', '12:00'),
            }),
            measured: measured(60),
          },
        ],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(tomorrowDayLoad).toBe(70);
    expect(actions.map((action) => action.rule)).toEqual([
      'sleep_target',
      'training_swap',
      'pre_meeting_reset',
      'buffer_walking',
      'recovery_block',
    ]);
    expect(actions.map((action) => action.impact)).toEqual([21, 21, 27, 16.8, 21]);
    expect(actions.map((action) => action.altersProjection)).toEqual([true, true, false, false, false]);
    expect(actions.map((action) => action.accepted)).toEqual([false, false, false, false, false]);

    expect(actions[0]).toMatchObject({
      id: 'sleep_target:2026-10-05',
      title: 'Lights out by 22:45',
      evidence: 'You usually wake at 06:30. 7h30 of sleep before a Monday this heavy means lights out by 22:45.',
      evidenceRefs: [],
      change: {
        kind: 'sleep_target',
        bedtime: at(TODAY, '22:45'),
        wake: at(TOMORROW, '06:30'),
        sleepHours: 7.5,
        forDate: TOMORROW,
      },
    });
    expect(actions[1]).toMatchObject({
      id: 'training_swap:intervals',
      title: "Move tomorrow's intervals to Saturday",
      evidence: 'Hard training the evening before a heavy day adds load when you have the least headroom.',
      evidenceRefs: [],
      change: {
        kind: 'move_workout',
        workoutId: 'intervals',
        start: at('2026-10-10', '18:30'),
        end: at('2026-10-10', '19:30'),
      },
    });
    expect(actions[2]).toMatchObject({
      id: 'pre_meeting_reset:board',
      title: '10-minute walk at 09:45 before the Board meeting',
      evidence: 'Board meetings cost you a lot: your stress takes about 45 minutes to return to baseline afterwards.',
      change: {
        kind: 'add_block',
        title: '10-minute walk',
        start: at(TOMORROW, '09:45'),
        end: at(TOMORROW, '09:55'),
        forDate: TOMORROW,
      },
    });
    expect(actions[2]!.evidenceRefs).toEqual([
      { label: 'Board meeting', meetingId: 'b-new', link: 'meeting' },
      { label: 'Board meeting', meetingId: 'b-mid', link: 'meeting' },
      { label: 'Board meeting', meetingId: 'b-old', link: 'meeting' },
    ]);
    expect(actions[3]).toMatchObject({
      id: 'buffer_walking:piotr-1on1',
      title: 'Make the 1:1 with Piotr a 30-minute walking meeting at 12:15',
      evidence: 'Back-to-back after the Board meeting, and 1:1s with Piotr cost more than they feel (see Energy map).',
      change: {
        kind: 'add_block',
        title: 'Walking 1:1 with Piotr',
        start: at(TOMORROW, '12:15'),
        end: at(TOMORROW, '12:45'),
        forDate: TOMORROW,
      },
    });
    expect(actions[3]!.evidenceRefs).toEqual([
      { label: 'Board meeting', meetingId: 'board', link: 'meeting' },
      { label: 'Energy map', link: 'energy-map' },
    ]);
    expect(actions[4]).toMatchObject({
      id: 'recovery_block:2026-10-06',
      title: 'Protect 30 minutes on Tuesday at 12:00',
      change: {
        kind: 'add_block',
        title: 'Recovery block',
        start: at('2026-10-06', '12:00'),
        end: at('2026-10-06', '12:30'),
        forDate: '2026-10-06',
      },
    });
  });

  test('ranks two buffers by meeting load and keeps a heavier recovery behind them', () => {
    const first = scored(
      { id: 'low', title: '1:1', type: 'one_on_one', start: at(TOMORROW, '12:00'), end: at(TOMORROW, '12:30'), attendeeIds: ['piotr'] },
      50,
      { backToBack: true, lateStart: false },
    );
    const anchor = scored(
      { id: 'anchor', title: 'Board meeting', type: 'board', start: at(TOMORROW, '15:30'), end: at(TOMORROW, '16:00') },
      20,
    );
    const second = scored(
      {
        id: 'high',
        title: 'Customer call',
        type: 'customer',
        start: at(TOMORROW, '16:00'),
        end: at(TOMORROW, '16:30'),
        attendeeIds: ['tomasz'],
      },
      80,
      { backToBack: true, lateStart: true },
    );
    const filler = scored(
      { id: 'filler', title: 'Workshop', type: 'team_sync', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') },
      40,
    );
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 40,
        tomorrowGap: 10,
        medianWakeMinutes14d: null,
        days: [
          { date: TODAY, meetings: [], workouts: [], capacity: 100 },
          { date: TOMORROW, meetings: [filler, first, anchor, second], workouts: [], capacity: 10 },
          { date: '2026-10-06', meetings: [], workouts: [], capacity: 100 },
          { date: '2026-10-07', meetings: [], workouts: [], capacity: 100 },
          { date: '2026-10-08', meetings: [], workouts: [], capacity: 100 },
          { date: '2026-10-09', meetings: [], workouts: [], capacity: 100 },
          { date: '2026-10-10', meetings: [], workouts: [], capacity: 100 },
        ],
        people: [
          { id: 'piotr', name: 'Piotr Nowak', role: null },
          { id: 'tomasz', name: 'Tomasz Zielinski', role: null },
        ],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions.map((action) => action.id)).toEqual(['buffer_walking:high', 'buffer_walking:low', 'recovery_block:2026-10-06']);
    expect(actions[0]!.impact).toBe(8);
    expect(actions[1]!.impact).toBe(5);
    expect(actions[0]!.evidence).toBe('Back-to-back after the Board meeting.');
    expect(actions[0]!.title).toBe('Make the Customer call with Tomasz a 30-minute walking meeting at 16:15');
  });

  test('sleep fires on gap 8 or day load 70, and not below either threshold or without a wake time', () => {
    const base = {
      now: NOW,
      timeZone: WARSAW,
      today: TODAY,
      tomorrow: TOMORROW,
      medianWakeMinutes14d: 6 * 60 + 30,
      days: [{ date: TODAY, meetings: [], workouts: [], capacity: 50 }, { date: TOMORROW, meetings: [], workouts: [], capacity: 50 }],
      people: [],
      energy: [],
      pastMeetings: [],
      pastWorkouts: [],
      historyDayLoads: [],
      nights: [],
    };
    const ids = (tomorrowDayLoad: number, tomorrowGap: number | null, wake: number | null = 6 * 60 + 30) =>
      recommendActions({ ...base, tomorrowDayLoad, tomorrowGap, medianWakeMinutes14d: wake }, ENGINE_CONFIG).map((action) => action.rule);

    expect(ids(40, 8)).toEqual(['sleep_target']);
    expect(ids(70, 0)).toEqual(['sleep_target']);
    expect(ids(69, 7.9)).toEqual([]);
    expect(ids(90, 20, null)).toEqual([]);
    expect(ids(90, null)).toEqual(['sleep_target']);
  });

  test('moves a tempo the evening before a heavy day, and leaves easy runs and past workouts', () => {
    const heavy = scored(
      { id: 'heavy', title: 'Board meeting', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') },
      80,
    );
    const tempo = workout({ id: 'tempo', intensity: 'tempo', start: at(TODAY, '18:30'), end: at(TODAY, '19:30') });
    const easy = workout({ id: 'easy', intensity: 'easy', start: at(TOMORROW, '07:00'), end: at(TOMORROW, '08:00') });
    const past = workout({ id: 'past', intensity: 'intervals', start: at('2026-09-30', '18:30'), end: at('2026-09-30', '19:30') });
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 80,
        tomorrowGap: 0,
        medianWakeMinutes14d: null,
        days: [
          { date: TODAY, meetings: [], workouts: [tempo], capacity: 90 },
          { date: TOMORROW, meetings: [heavy], workouts: [easy], capacity: 90 },
          { date: '2026-10-06', meetings: [], workouts: [], capacity: 90 },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [past],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions.map((action) => action.id)).toEqual(['training_swap:tempo', 'pre_meeting_reset:heavy']);
    expect(actions[0]!.title).toBe("Move today's tempo to Tuesday");
    expect(actions[0]!.change).toMatchObject({ start: at('2026-10-06', '18:30'), end: at('2026-10-06', '19:30') });
  });

  test('skips a training swap when no later day in the week is under the target load', () => {
    const heavyMeeting = (date: string) =>
      scored({ id: date, title: 'Board', type: 'board', start: at(date, '10:00'), end: at(date, '14:00') }, 80);
    const intervals = workout({ id: 'intervals', intensity: 'intervals', start: at(TOMORROW, '18:30'), end: at(TOMORROW, '19:30') });
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 80,
        tomorrowGap: 0,
        medianWakeMinutes14d: null,
        days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map((date) => ({
          date,
          meetings: [heavyMeeting(date)],
          workouts: date === TOMORROW ? [intervals] : [],
          capacity: 90,
        })),
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions.map((action) => action.rule)).not.toContain('training_swap');
  });

  test('cites the last 3 hard-training nights and the mean HRV drop', () => {
    const drops = [
      { workout: '2026-08-10', heavy: '2026-08-11', hrv: 40 },
      { workout: '2026-09-01', heavy: '2026-09-02', hrv: 42.5 },
      { workout: '2026-09-14', heavy: '2026-09-15', hrv: 42.5 },
      { workout: '2026-09-28', heavy: '2026-09-29', hrv: 42.5 },
    ];
    const nights: Night[] = [];
    for (const date of [
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
    ]) {
      nights.push(night(date, 50));
    }
    drops.forEach((drop) => nights.push(night(drop.heavy, drop.hrv)));
    const intervals = workout({ id: 'intervals', intensity: 'intervals', start: at(TOMORROW, '18:30'), end: at(TOMORROW, '19:30') });
    const [action] = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 80,
        tomorrowGap: 10,
        medianWakeMinutes14d: null,
        days: [
          { date: TOMORROW, meetings: [scored({ id: 'b', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') }, 80)], workouts: [intervals], capacity: 90 },
          { date: '2026-10-10', meetings: [], workouts: [], capacity: 90 },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: drops.map((drop) =>
          workout({
            id: drop.workout,
            intensity: 'intervals',
            start: at(drop.workout, '18:30'),
            end: at(drop.workout, '19:30'),
          }),
        ),
        historyDayLoads: drops.map((drop) => ({ date: drop.heavy, dayLoad: 74 })),
        nights,
      },
      ENGINE_CONFIG,
    );

    expect(action).toMatchObject({
      rule: 'training_swap',
      evidence: 'The last 3 times you did hard training before a heavy day, your HRV dropped about 15% the next night.',
    });
    expect(action!.evidenceRefs).toEqual([
      { label: '1 Sep', date: '2026-09-01' },
      { label: '14 Sep', date: '2026-09-14' },
      { label: '28 Sep', date: '2026-09-28' },
    ]);
  });

  test('says HRV rose when the next night was higher than the week before it', () => {
    const nights = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'].map((date) =>
      night(date, 50),
    );
    nights.push(night('2026-09-08', 60));
    const [action] = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 80,
        tomorrowGap: 0,
        medianWakeMinutes14d: null,
        days: [
          {
            date: TOMORROW,
            meetings: [scored({ id: 'b', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') }, 80)],
            workouts: [workout({ id: 'tempo', intensity: 'tempo', start: at(TOMORROW, '18:30'), end: at(TOMORROW, '19:30') })],
            capacity: 90,
          },
          { date: '2026-10-06', meetings: [], workouts: [], capacity: 90 },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [workout({ id: 'old-tempo', intensity: 'tempo', start: at('2026-09-07', '18:30'), end: at('2026-09-07', '19:30') })],
        historyDayLoads: [{ date: '2026-09-08', dayLoad: 72 }],
        nights,
      },
      ENGINE_CONFIG,
    );

    expect(action!.evidence).toBe(
      'The last time you did hard training before a heavy day, your HRV rose about 20% the next night.',
    );
    expect(action!.evidenceRefs).toEqual([{ label: '7 Sep', date: '2026-09-07' }]);
  });

  test('takes the heaviest meeting through tomorrow whose 15 minutes before are free', () => {
    const blocked = scored(
      { id: 'blocked', title: 'Board meeting', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '12:00') },
      95,
    );
    const standup = scored(
      { id: 'standup', title: 'Standup', type: 'standup', start: at(TOMORROW, '09:50'), end: at(TOMORROW, '10:00'), isGroup: true },
      15,
    );
    const later = scored(
      { id: 'investor', title: 'Investor call', type: 'investor', start: at(TOMORROW, '14:00'), end: at(TOMORROW, '15:00') },
      75,
    );
    const todayHeavy = scored(
      { id: 'today', title: 'Pitch', type: 'pitch', start: at(TODAY, '18:00'), end: at(TODAY, '19:00') },
      99,
    );
    const after = scored(
      { id: 'after', title: 'Board meeting', type: 'board', start: at('2026-10-06', '10:00'), end: at('2026-10-06', '12:00') },
      99,
    );
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 20,
        tomorrowGap: 0,
        medianWakeMinutes14d: null,
        days: [
          { date: TODAY, meetings: [todayHeavy], workouts: [], capacity: 90 },
          { date: TOMORROW, meetings: [standup, blocked, later], workouts: [], capacity: 90 },
          { date: '2026-10-06', meetings: [after], workouts: [], capacity: 90 },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions.map((action) => action.id)).toEqual(['pre_meeting_reset:today']);
    expect(actions[0]!.title).toBe('10-minute walk at 17:45 before the Pitch');
    expect(actions[0]!.evidence).toBe('This meeting is predicted to be demanding, and you have no measured history for this type yet.');
  });

  test('a hidden drain alone is enough for a walking 1:1, and a calm back-to-back under 50 is not', () => {
    const hidden = scored(
      { id: 'hidden', title: '1:1', type: 'one_on_one', start: at(TOMORROW, '15:00'), end: at(TOMORROW, '15:30'), attendeeIds: ['piotr', 'ola'] },
      30,
    );
    const calm = scored(
      { id: 'calm', title: 'Sync', type: 'team_sync', start: at(TOMORROW, '12:00'), end: at(TOMORROW, '12:30'), attendeeIds: ['ola'] },
      49,
      { backToBack: true, lateStart: false },
    );
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 20,
        tomorrowGap: 5,
        medianWakeMinutes14d: null,
        days: [{ date: TOMORROW, meetings: [calm, hidden], workouts: [], capacity: 80 }],
        people: [
          { id: 'piotr', name: 'Piotr Nowak', role: null },
          { id: 'ola', name: 'Ola Wisniewska', role: null },
        ],
        energy: [energy('piotr', 'Piotr Nowak', 'hidden_drain', 9), energy('ola', 'Ola Wisniewska', 'energizer', -6)],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: 'buffer_walking:hidden',
      title: 'Make the 1:1 with Piotr a 30-minute walking meeting at 15:15',
      evidence: '1:1s with Piotr cost more than they feel (see Energy map).',
      altersProjection: false,
    });
    expect(actions[0]!.evidenceRefs).toEqual([{ label: 'Energy map', link: 'energy-map' }]);
  });

  test('puts the recovery block on the day after a red day, in the earliest free 30 minutes', () => {
    const red = scored({ id: 'red', type: 'board', start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') }, 90);
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 90,
        tomorrowGap: 40,
        medianWakeMinutes14d: null,
        days: [
          { date: TOMORROW, meetings: [red], workouts: [], capacity: 40 },
          {
            date: '2026-10-06',
            meetings: [scored({ id: 'am', title: 'Workshop', start: at('2026-10-06', '09:00'), end: at('2026-10-06', '11:00') }, 20)],
            workouts: [workout({ id: 'easy', intensity: 'easy', start: at('2026-10-06', '16:00'), end: at('2026-10-06', '17:00') })],
            capacity: 90,
          },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    const recovery = actions.find((action) => action.rule === 'recovery_block');
    expect(recovery).toMatchObject({
      id: 'recovery_block:2026-10-06',
      title: 'Protect 30 minutes on Tuesday at 11:00',
      impact: 36,
    });
    expect(recovery!.change).toMatchObject({ start: at('2026-10-06', '11:00'), end: at('2026-10-06', '11:30') });
  });

  test('does not protect a day outside the week or a day with no 30-minute gap', () => {
    const packed = (date: string) =>
      scored({ id: date, title: 'Workshop', start: at(date, '09:00'), end: at(date, '17:00') }, 40);
    const actions = recommendActions(
      {
        now: NOW,
        timeZone: WARSAW,
        today: TODAY,
        tomorrow: TOMORROW,
        tomorrowDayLoad: 10,
        tomorrowGap: 25,
        medianWakeMinutes14d: null,
        days: [
          { date: '2026-10-09', meetings: [packed('2026-10-09')], workouts: [], capacity: 10 },
          { date: '2026-10-10', meetings: [packed('2026-10-10')], workouts: [], capacity: 90 },
        ],
        people: [],
        energy: [],
        pastMeetings: [],
        pastWorkouts: [],
        historyDayLoads: [],
        nights: [],
      },
      ENGINE_CONFIG,
    );

    expect(actions.map((action) => action.rule)).not.toContain('recovery_block');
  });
});
