import type { EngineMeeting, EnginePerson, EngineWorkout, Measured } from '../../src/engine/types';
import type { Action, ForecastResult, MeetingLoad, PredictedMeeting } from '../../src/forecast/engine.port';

export const at = (iso: string): number => Date.parse(iso);

export const PEOPLE: readonly EnginePerson[] = [
  { id: 'p-anna', name: 'Anna Kowalska', role: 'Lead investor' },
  { id: 'p-piotr', name: 'Piotr Nowak', role: 'Co-founder, CTO' },
  { id: 'p-kasia', name: 'Kasia Wójcik', role: 'Independent board member' },
];

export const BOARD: EngineMeeting = {
  kind: 'meeting',
  id: 'm-board-tomorrow',
  title: 'Board meeting',
  type: 'board',
  start: at('2026-10-05T10:00:00+02:00'),
  end: at('2026-10-05T12:00:00+02:00'),
  attendeeIds: ['p-anna', 'p-kasia', 'p-piotr'],
  isGroup: false,
};

export const PAST_BOARD: EngineMeeting = {
  ...BOARD,
  id: 'm-board-past',
  start: at('2026-09-28T10:00:00+02:00'),
  end: at('2026-09-28T12:00:00+02:00'),
};

export const PIOTR_1ON1: EngineMeeting = {
  kind: 'meeting',
  id: 'm-piotr-friday',
  title: '1:1 with Piotr',
  type: 'one_on_one',
  start: at('2026-10-02T16:30:00+02:00'),
  end: at('2026-10-02T17:00:00+02:00'),
  attendeeIds: ['p-piotr'],
  isGroup: false,
};

export const INTERVALS: EngineWorkout = {
  kind: 'workout',
  id: 'w-intervals',
  title: 'Run: intervals 6 x 800 m',
  intensity: 'intervals',
  start: at('2026-10-05T18:30:00+02:00'),
  end: at('2026-10-05T19:30:00+02:00'),
  movedByHeadroom: false,
};

export const predicted = (meeting: EngineMeeting, load: number): PredictedMeeting => ({
  meeting,
  load,
  basis: { typeMeetings: 3, personMeetings: [{ personId: 'p-piotr', meetings: 15 }] },
  label: 'Based on 3 of your meetings + population default',
  modifiers: { backToBack: false, lateStart: false },
});

export const SLEEP_ACTION: Action = {
  id: 'sleep_target:2026-10-05',
  rule: 'sleep_target',
  title: 'Lights out by 22:45',
  evidence: 'You usually wake at 06:30.',
  evidenceRefs: [],
  impact: 24.1,
  altersProjection: true,
  change: {
    kind: 'sleep_target',
    bedtime: at('2026-10-04T22:45:00+02:00'),
    wake: at('2026-10-05T06:30:00+02:00'),
    sleepHours: 7.5,
    forDate: '2026-10-05',
  },
  accepted: false,
};

export const SWAP_ACTION: Action = {
  id: 'training_swap:w-intervals',
  rule: 'training_swap',
  title: "Move tomorrow's intervals to Saturday",
  evidence: 'The last 3 times you did hard training before a heavy day, your HRV dropped about 15% the next night.',
  evidenceRefs: [{ label: '14 Sep', date: '2026-09-14' }],
  impact: 24.1,
  altersProjection: true,
  change: { kind: 'move_workout', workoutId: 'w-intervals', start: at('2026-10-10T18:30:00+02:00'), end: at('2026-10-10T19:30:00+02:00') },
  accepted: false,
};

export const RESET_ACTION: Action = {
  id: 'pre_meeting_reset:m-board-tomorrow',
  rule: 'pre_meeting_reset',
  title: '10-minute walk at 09:45 before the Board meeting',
  evidence: 'Board meetings cost you a lot.',
  evidenceRefs: [{ label: 'Board meeting', meetingId: 'm-board-past', link: 'meeting' }],
  impact: 24.1,
  altersProjection: false,
  change: {
    kind: 'add_block',
    title: '10-minute walk',
    start: at('2026-10-05T09:45:00+02:00'),
    end: at('2026-10-05T09:55:00+02:00'),
    forDate: '2026-10-05',
  },
  accepted: false,
};

export const PAST_BOARD_MEASURED: Measured<MeetingLoad> = {
  kind: 'ok',
  value: {
    load: 89.6,
    excessStress: 36.2,
    recoveryTailMin: 44,
    validSamples: 40,
    signal: 'stress',
    recoveredAt: at('2026-09-28T12:44:00+02:00'),
  },
};

/** A Marta-like forecast computed at 11:00 local on 2026-10-04. */
export const forecastFixture = (overrides: Partial<ForecastResult> = {}): ForecastResult => ({
  computedAt: at('2026-10-04T11:00:00+02:00'),
  capacityNow: {
    score: 54.2,
    components: [
      { kind: 'sleep', score: 81.1, weight: 0.35, detail: '6h05 last night (target 7h30)' },
      { kind: 'hrv', score: 25, weight: 0.3, detail: 'HRV 10% below your 7-day average' },
      { kind: 'bodyBattery', score: 41, weight: 0.25, detail: 'Body Battery 41 at wake-up' },
      { kind: 'resilience', score: 75, weight: 0.1, detail: 'Resilience 75 (open-wearables)' },
    ],
  },
  outlook: { capacity: 54.2, dayLoad: 83.4, gap: 29.2, gapLevel: 'red' },
  projected: null,
  tomorrow: {
    date: '2026-10-05',
    dayLoad: 83.4,
    meetings: [predicted(BOARD, 83.1)],
    workouts: [INTERVALS],
    heaviestInDays: 42,
  },
  upcoming: [predicted(BOARD, 83.1)],
  week: [
    { date: '2026-10-04', dayLoad: 20, capacityForecast: 54.2, meetings: [], workouts: [] },
    { date: '2026-10-05', dayLoad: 83.4, capacityForecast: 54.2, meetings: [predicted(BOARD, 83.1)], workouts: [INTERVALS] },
  ],
  actions: [SLEEP_ACTION, SWAP_ACTION, RESET_ACTION],
  energyMap: {
    entries: [
      {
        person: PEOPLE[1] ?? { id: 'p-piotr', name: 'Piotr Nowak', role: null },
        meetings: 15,
        bodyEffect: 14.6,
        felt: 0.4,
        reflections: 10,
        group: 'hidden_drain',
        confidence: 'high',
        explanation: 'Meetings with Piotr cost you about +15 points more than they feel.',
      },
    ],
    belowThresholdCount: 21,
  },
  measured: new Map<string, Measured<MeetingLoad>>([
    [PAST_BOARD.id, PAST_BOARD_MEASURED],
    [PIOTR_1ON1.id, { kind: 'insufficient', reason: 'too_few_sedentary_samples', detail: 'Only 3 still samples.' }],
  ]),
  baseline: { stressByHour: Array.from({ length: 24 }, () => 25), hrByHour: Array.from({ length: 24 }, () => 68) },
  headline: 'Tomorrow is your heaviest day in 6 weeks.',
  ...overrides,
});
