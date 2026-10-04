import type {
  AcceptActionResultDto,
  ActionDto,
  BlockDto,
  BriefingDto,
  CapacityDto,
  DayOutlookDto,
  EnergyMapDto,
  EnergyMapEntryDto,
  LiveDto,
  LivePointDto,
  MeetingDetailDto,
  MeetingType,
  PendingCheckInDto,
  PersonDto,
  PredictedMeetingDto,
  Rating,
  ReflectionResultDto,
  TracePointDto,
  UserKey,
  UserSummaryDto,
  WeekDayDto,
  WeekDto,
  WorkoutDto,
} from '@contracts';
import { gapLevelFor } from '../app/domain/gap';
import { regionOf } from '../app/domain/quadrant';
import { addDays, localDate, weekdayOfDate } from '../app/domain/time';

const TZ = 'Europe/Warsaw';
const HOW = 'Only time you sat still counts; compared with your own baseline for the same hour; walking and workouts excluded.';
const STORAGE_KEY = 'headroom-mock-v1';

const anna: PersonDto = { id: 'anna', name: 'Anna Kowalska', role: 'Lead investor' };
const kasia: PersonDto = { id: 'kasia', name: 'Kasia Wójcik', role: 'Independent board member' };
const piotr: PersonDto = { id: 'piotr', name: 'Piotr Nowak', role: 'Co-founder, CTO' };
const michal: PersonDto = { id: 'michal', name: 'Michał Zieliński', role: 'Fund partner' };
const tomasz: PersonDto = { id: 'tomasz', name: 'Tomasz Lewandowski', role: 'Customer' };
const ola: PersonDto = { id: 'ola', name: 'Ola Wiśniewska', role: 'Head of Product' };

export const users: readonly UserSummaryDto[] = [
  { key: 'jakub', displayName: 'Jakub', isSynthetic: false, live: true, timeZone: TZ },
  { key: 'marta', displayName: 'Marta', isSynthetic: true, live: false, timeZone: TZ },
];

const isUser = (key: string): key is UserKey => key === 'jakub' || key === 'marta';

export const todayInWarsaw = (now = new Date()): string => localDate(now.toISOString(), TZ);

const offsetFor = (isoDate: string): string => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${isoDate}T12:00:00Z`)));
  const diff = hour - 12;
  const sign = diff >= 0 ? '+' : '-';
  return `${sign}${String(Math.abs(diff)).padStart(2, '0')}:00`;
};

const at = (isoDate: string, hhmm: string): string => `${isoDate}T${hhmm}:00${offsetFor(isoDate)}`;

const findWeekday = (start: string, weekday: string, direction: 1 | -1): string => {
  let cursor = start;
  for (let step = 0; step < 8; step += 1) {
    if (weekdayOfDate(cursor) === weekday) return cursor;
    cursor = addDays(cursor, direction);
  }
  return start;
};

const meeting = (
  id: string,
  title: string,
  type: MeetingType,
  start: string,
  end: string,
  attendees: readonly PersonDto[],
  predictedLoad: number,
  label: string,
  modifiers: { backToBack?: boolean; lateStart?: boolean } = {},
  isGroup = false,
): PredictedMeetingDto => ({
  id,
  title,
  type,
  start,
  end,
  attendees,
  isGroup,
  predictedLoad,
  basis: { typeMeetings: type === 'pitch' ? 1 : 3, personMeetings: attendees.map(person => ({ personId: person.id, meetings: 4 })), label },
  modifiers: { backToBack: modifiers.backToBack ?? false, lateStart: modifiers.lateStart ?? false },
});

const outlook = (capacity: number | null, dayLoad: number): DayOutlookDto => {
  const gap = capacity === null ? null : dayLoad - capacity;
  return { capacity, dayLoad, gap, gapLevel: gapLevelFor(gap) };
};

interface Persisted {
  readonly day: string;
  readonly accepted: readonly string[];
  readonly reflections: Readonly<Record<string, Rating>>;
  readonly extraPoints: readonly LivePointDto[];
  readonly lastSyncAt: string | null;
}

const emptyState = (day: string): Persisted => ({ day, accepted: [], reflections: {}, extraPoints: [], lastSyncAt: null });

const readState = (): Persisted => {
  const day = todayInWarsaw();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState(day);
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.day !== day || !Array.isArray(parsed.accepted)) return emptyState(day);
    return parsed;
  } catch {
    return emptyState(day);
  }
};

let state = readState();

const write = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the session still works in memory */
  }
};

const accepted = (): ReadonlySet<string> => new Set(state.accepted);

const martaActions = (tomorrow: string, today: string): readonly ActionDto[] => {
  const done = accepted();
  return [
    {
      id: `sleep_target:${tomorrow}`,
      rule: 'sleep_target',
      title: 'Lights out by 22:45',
      evidence: '6h05 last night, same as your 7-day average. A 7h30 night is the largest lever on tomorrow.',
      evidenceRefs: [{ label: 'Sleep 6h05', date: today }],
      impact: 24.1,
      altersProjection: true,
      accepted: done.has(`sleep_target:${tomorrow}`),
    },
    {
      id: `training_swap:${tomorrow}`,
      rule: 'training_swap',
      title: "Move tomorrow's intervals to Saturday",
      evidence: 'The last 3 times you did hard training before a heavy day, your HRV dropped about 15% the next night.',
      evidenceRefs: [
        { label: 'HRV -16%', date: '2026-08-27' },
        { label: 'HRV -14%', date: '2026-09-10' },
        { label: 'HRV -15%', date: '2026-09-24' },
      ],
      impact: 24.1,
      altersProjection: true,
      accepted: done.has(`training_swap:${tomorrow}`),
    },
    {
      id: `pre_meeting_reset:${tomorrow}`,
      rule: 'pre_meeting_reset',
      title: '10-minute walk at 09:45 before the Board meeting',
      evidence: 'Board meetings cost you a lot: your stress takes about 45 minutes to return to baseline afterwards.',
      evidenceRefs: [{ label: 'Board meeting', link: 'meeting', meetingId: 'marta-board' }],
      impact: 18.4,
      altersProjection: false,
      accepted: done.has(`pre_meeting_reset:${tomorrow}`),
    },
    {
      id: `buffer_walking:${tomorrow}`,
      rule: 'buffer_walking',
      title: 'Make the 1:1 with Piotr a 30-minute walking meeting at 12:15',
      evidence: 'Back-to-back after the board, and 1:1s with Piotr cost more than they feel (see Energy map)',
      evidenceRefs: [{ label: 'Energy map', link: 'energy-map' }],
      impact: 16.2,
      altersProjection: false,
      accepted: done.has(`buffer_walking:${tomorrow}`),
    },
  ];
};

const martaMeetings = (tomorrow: string): readonly PredictedMeetingDto[] => [
  meeting('marta-standup', 'Standup', 'standup', at(tomorrow, '09:00'), at(tomorrow, '09:15'), [], 15, 'Based on 30 of your meetings', {}, true),
  meeting(
    'marta-board',
    'Board meeting',
    'board',
    at(tomorrow, '10:00'),
    at(tomorrow, '12:00'),
    [anna, kasia, piotr],
    83,
    'Based on 3 of your board meetings',
  ),
  meeting(
    'marta-piotr',
    '1:1',
    'one_on_one',
    at(tomorrow, '12:00'),
    at(tomorrow, '12:30'),
    [piotr],
    56,
    'Based on 12 of your 1:1 meetings',
    { backToBack: true },
  ),
  meeting(
    'marta-investor',
    'Investor call',
    'investor',
    at(tomorrow, '14:00'),
    at(tomorrow, '15:00'),
    [anna, michal],
    76,
    'Based on 8 of your investor meetings',
  ),
  meeting(
    'marta-customer',
    'Customer call',
    'customer',
    at(tomorrow, '16:30'),
    at(tomorrow, '17:00'),
    [tomasz],
    52,
    'Based on 10 of your customer meetings',
    { lateStart: true },
  ),
];

const intervals = (day: string, moved: boolean): WorkoutDto => ({
  id: 'marta-intervals',
  title: 'Run: intervals 6 x 800 m',
  intensity: 'intervals',
  start: at(day, '18:30'),
  end: at(day, '19:30'),
  load: 8,
  movedByHeadroom: moved,
});

const blocksFor = (today: string, tomorrow: string): readonly BlockDto[] => {
  const done = accepted();
  const blocks: BlockDto[] = [];
  if (done.has(`sleep_target:${tomorrow}`)) {
    blocks.push({
      id: 'lights-out',
      actionId: `sleep_target:${tomorrow}`,
      title: 'Lights out 22:45',
      start: at(today, '22:45'),
      end: at(tomorrow, '06:30'),
      forDate: tomorrow,
    });
  }
  if (done.has(`pre_meeting_reset:${tomorrow}`)) {
    blocks.push({
      id: 'walk',
      actionId: `pre_meeting_reset:${tomorrow}`,
      title: '10-minute walk',
      start: at(tomorrow, '09:45'),
      end: at(tomorrow, '09:55'),
      forDate: tomorrow,
    });
  }
  if (done.has(`buffer_walking:${tomorrow}`)) {
    blocks.push({
      id: 'walking-1-1',
      actionId: `buffer_walking:${tomorrow}`,
      title: 'Walking 1:1 with Piotr',
      start: at(tomorrow, '12:15'),
      end: at(tomorrow, '12:45'),
      forDate: tomorrow,
    });
  }
  return blocks;
};

const martaProjection = (tomorrow: string): { outlook: DayOutlookDto; projected: DayOutlookDto | null; dayLoad: number; capacity: number } => {
  const done = accepted();
  const slept = done.has(`sleep_target:${tomorrow}`);
  const moved = done.has(`training_swap:${tomorrow}`);
  const base = outlook(54, 83);
  const any = martaActions(tomorrow, todayInWarsaw()).some(action => action.accepted);
  const capacity = slept ? 60 : 54;
  const dayLoad = moved ? 75 : 83;
  return { outlook: base, projected: any ? outlook(capacity, dayLoad) : null, dayLoad, capacity };
};

const martaCapacity = (): CapacityDto => ({
  score: 54,
  components: [
    { kind: 'sleep', score: 81, weight: 0.35, detail: '6h05 last night (target 7h30)' },
    { kind: 'hrv', score: 25, weight: 0.3, detail: 'HRV 10% below your 7-day average' },
    { kind: 'bodyBattery', score: 41, weight: 0.25, detail: 'Body Battery 41 at wake-up' },
    { kind: 'resilience', score: 75, weight: 0.1, detail: 'Resilience 75 (open-wearables)' },
  ],
});

const jakubCapacity = (): CapacityDto => ({
  score: 36,
  components: [
    { kind: 'sleep', score: 62, weight: 0.35, detail: '4h40 last night (target 7h30)' },
    { kind: 'hrv', score: 22, weight: 0.3, detail: 'HRV 18% below your 7-day average' },
    { kind: 'bodyBattery', score: 28, weight: 0.25, detail: 'Body Battery 28 at wake-up' },
    { kind: 'resilience', score: 61, weight: 0.1, detail: 'Resilience 61 (open-wearables)' },
  ],
});

const pitchStart = (now: Date, today: string): string => {
  const eleven = Date.parse(at(today, '11:00'));
  if (eleven > now.getTime() + 20 * 60_000) return at(today, '11:00');
  const ahead = new Date(now.getTime() + 90 * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ahead);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '12');
  const rounded = (hour + 1) % 24;
  return at(today, `${String(rounded).padStart(2, '0')}:00`);
};

const juryPitch = (now: Date, today: string): PredictedMeetingDto => {
  const start = pitchStart(now, today);
  const endMs = Date.parse(start) + 12 * 60_000;
  const endParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(endMs));
  const hh = endParts.find(part => part.type === 'hour')?.value ?? '11';
  const mm = endParts.find(part => part.type === 'minute')?.value ?? '12';
  return meeting('jakub-jury', 'Jury pitch', 'pitch', start, at(today, `${hh}:${mm}`), [], 71, 'Based on 1 of your meetings + population default');
};

const liveSeries = (now: number): LiveDto => {
  const points: LivePointDto[] = [];
  const start = now - 3 * 60 * 60 * 1000;
  for (let t = start; t <= now - 2 * 60 * 1000; t += 2 * 60 * 1000) {
    const step = (t - start) / 120_000;
    points.push({
      t: new Date(t).toISOString(),
      stress: Math.round(44 + Math.sin(step / 4) * 10),
      heartRate: Math.round(66 + Math.sin(step / 3) * 6),
    });
  }
  const last = points.at(-1);
  if (last) points[points.length - 1] = { ...last, stress: 58, heartRate: 84 };
  const extra = state.extraPoints;
  const all = [...points, ...extra];
  return {
    lastSampleAt: all.at(-1)?.t ?? null,
    lastSyncAt: state.lastSyncAt ?? new Date(now - 4 * 60_000).toISOString(),
    points: all,
  };
};

const pastBoardDate = (today: string): string => addDays(today, -6);

const traceFor = (day: string, startHm: string, endHm: string, plateau: number, baseline = 25): readonly TracePointDto[] => {
  const start = Date.parse(at(day, startHm));
  const end = Date.parse(at(day, endHm));
  const from = start - 30 * 60_000;
  const to = end + 120 * 60_000;
  const recovered = end + 45 * 60_000;
  const points: TracePointDto[] = [];
  for (let t = from; t <= to; t += 5 * 60_000) {
    let stress = baseline + Math.round(Math.sin(t / 600_000) * 2);
    if (t >= start && t <= end) stress = baseline + plateau;
    else if (t > end && t < recovered) {
      const fade = 1 - (t - end) / (recovered - end);
      stress = baseline + Math.round(plateau * fade);
    }
    points.push({
      t: new Date(t).toISOString(),
      stress,
      heartRate: 68 + Math.round((stress - baseline) * 0.4),
      baselineStress: baseline,
    });
  }
  return points;
};

const pastBoards = (today: string) => {
  const recent = pastBoardDate(today);
  return [
    { id: 'marta-board-past', title: 'Board meeting', start: at(recent, '10:00'), measuredLoad: 90 },
    { id: 'marta-board-2', title: 'Board meeting', start: at(addDays(recent, -14), '10:00'), measuredLoad: 84 },
    { id: 'marta-board-3', title: 'Board meeting', start: at(addDays(recent, -28), '10:00'), measuredLoad: 78 },
  ];
};

const energyPeople = (): readonly EnergyMapEntryDto[] => {
  const friday = state.reflections['marta-piotr-friday'];
  const piotrFelt = friday === undefined ? 0 : friday === 1 ? 0.35 : friday === -1 ? -0.4 : 0;
  const seeds: readonly EnergyMapEntryDto[] = [
    {
      person: anna,
      meetings: 6,
      bodyEffect: 13.6,
      felt: -0.67,
      reflections: 4,
      group: 'known_drain',
      confidence: 'high',
      explanation: 'Anna is a known drain: your stress rises with her, and you already feel it.',
    },
    {
      person: piotr,
      meetings: 15,
      bodyEffect: 11.8,
      felt: piotrFelt,
      reflections: friday === undefined ? 4 : 5,
      group: 'hidden_drain',
      confidence: 'high',
      explanation: 'Piotr looks fine in the room. Your body pays for the 1:1 afterwards.',
    },
    {
      person: ola,
      meetings: 12,
      bodyEffect: -6.1,
      felt: 0.75,
      reflections: 5,
      group: 'energizer',
      confidence: 'high',
      explanation: 'Ola gives the hour back. You leave product reviews higher than you entered.',
    },
    {
      person: tomasz,
      meetings: 4,
      bodyEffect: 0.8,
      felt: -0.75,
      reflections: 3,
      group: 'overestimated',
      confidence: 'medium',
      explanation: 'Tomasz feels heavy, but your body barely moves. The load belongs to the customer format.',
    },
    {
      person: kasia,
      meetings: 5,
      bodyEffect: 0.3,
      felt: 0,
      reflections: 2,
      group: 'neutral',
      confidence: 'medium',
      explanation: 'Board meetings are demanding for you; Kasia herself is not.',
    },
  ];
  return seeds.map(entry => ({ ...entry, group: regionOf(entry.bodyEffect, entry.felt) }));
};

const briefingFor = (key: UserKey, now = new Date()): BriefingDto => {
  const today = todayInWarsaw(now);
  const tomorrow = addDays(today, 1);
  const user = users.find(item => item.key === key)!;
  if (key === 'marta') {
    const plan = martaProjection(tomorrow);
    const moved = accepted().has(`training_swap:${tomorrow}`);
    return {
      user,
      computedAt: now.toISOString(),
      stale: false,
      headline: 'Tomorrow is your heaviest day in 6 weeks.',
      capacity: martaCapacity(),
      tomorrow: {
        date: tomorrow,
        dayLoad: plan.dayLoad,
        meetings: martaMeetings(tomorrow),
        workouts: moved ? [] : [intervals(tomorrow, false)],
        heaviestInDays: 42,
      },
      outlook: plan.outlook,
      projected: plan.projected,
      actions: martaActions(tomorrow, today),
      upcoming: martaMeetings(tomorrow),
      live: null,
    };
  }
  const pitch = juryPitch(now, today);
  return {
    user,
    computedAt: now.toISOString(),
    stale: false,
    headline: 'Short hackathon sleep. The Jury pitch is still ahead.',
    capacity: jakubCapacity(),
    tomorrow: { date: tomorrow, dayLoad: 18, meetings: [], workouts: [], heaviestInDays: null },
    outlook: outlook(36, 18),
    projected: null,
    actions: [
      {
        id: `recovery_block:${today}`,
        rule: 'recovery_block',
        title: 'Keep the hour before the Jury pitch clear',
        evidence: 'One prior pitch is all the model has. The population default still carries most of the estimate.',
        evidenceRefs: [],
        impact: 8,
        altersProjection: false,
        accepted: accepted().has(`recovery_block:${today}`),
      },
    ],
    upcoming: [pitch],
    live: liveSeries(now.getTime()),
  };
};

const weekFor = (key: UserKey, now = new Date()): WeekDto => {
  const today = todayInWarsaw(now);
  const tomorrow = addDays(today, 1);
  const days: WeekDayDto[] = [];
  if (key === 'marta') {
    const saturday = findWeekday(today, 'Saturday', 1);
    const moved = accepted().has(`training_swap:${tomorrow}`);
    const slept = accepted().has(`sleep_target:${tomorrow}`);
    const bases = [18, 34, 22, 40, 16, 28, 14];
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(today, index);
      const workoutHere = moved ? date === saturday : date === tomorrow;
      const meetings = date === tomorrow ? martaMeetings(tomorrow) : [];
      const base = date === tomorrow ? 75 : date === saturday ? 0 : (bases[index] ?? 16);
      days.push({
        date,
        dayLoad: base + (workoutHere ? 8 : 0),
        capacityForecast: date === tomorrow && slept ? 60 : 54,
        meetings,
        workouts: workoutHere ? [intervals(date, moved)] : [],
        blocks: date === tomorrow ? blocksFor(today, tomorrow) : [],
      });
    }
  } else {
    const pitch = juryPitch(now, today);
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(today, index);
      days.push({
        date,
        dayLoad: date === today ? 48 : [22, 16, 30, 14, 20, 12][index] ?? 12,
        capacityForecast: 36,
        meetings: date === today ? [pitch] : [],
        workouts: [],
        blocks: [],
      });
    }
  }
  return { computedAt: now.toISOString(), stale: false, days };
};

const meetingFor = (key: UserKey, id: string, now = new Date()): MeetingDetailDto | null => {
  const today = todayInWarsaw(now);
  const tomorrow = addDays(today, 1);
  const howWeMeasure = HOW;
  if (key === 'jakub' && id === 'jakub-jury') {
    const pitch = juryPitch(now, today);
    return {
      meeting: pitch,
      measured: null,
      insufficientReason: null,
      predicted: pitch,
      trace: [],
      pastSameType: [{ id: 'jakub-rehearsal', title: 'Pitch rehearsal', start: at(addDays(today, -1), '18:00'), measuredLoad: 68 }],
      howWeMeasure,
    };
  }
  if (key === 'jakub' && id === 'jakub-rehearsal') {
    const day = addDays(today, -1);
    return {
      meeting: { id, title: 'Pitch rehearsal', type: 'pitch', start: at(day, '18:00'), end: at(day, '18:40'), attendees: [], isGroup: false },
      measured: { load: 68, excessStress: 22, recoveryTailMin: 30, validSamples: 9, signal: 'stress', recoveredAt: at(day, '19:10') },
      insufficientReason: null,
      predicted: null,
      trace: traceFor(day, '18:00', '18:40', 22),
      pastSameType: [],
      howWeMeasure,
    };
  }
  if (key !== 'marta') return null;
  const future = martaMeetings(tomorrow).find(item => item.id === id);
  if (future) {
    return {
      meeting: future,
      measured: null,
      insufficientReason: null,
      predicted: future,
      trace: [],
      pastSameType: future.type === 'board' ? pastBoards(today) : [],
      howWeMeasure,
    };
  }
  const past = pastBoards(today).find(item => item.id === id);
  if (past) {
    const day = past.start.slice(0, 10);
    return {
      meeting: {
        id: past.id,
        title: past.title,
        type: 'board',
        start: past.start,
        end: at(day, '12:00'),
        attendees: [anna, kasia, piotr],
        isGroup: false,
      },
      measured: {
        load: past.measuredLoad ?? 90,
        excessStress: past.id === 'marta-board-past' ? 36 : 28,
        recoveryTailMin: past.id === 'marta-board-past' ? 45 : 38,
        validSamples: 18,
        signal: 'stress',
        recoveredAt: at(day, '12:45'),
      },
      insufficientReason: null,
      predicted: null,
      trace: traceFor(day, '10:00', '12:00', past.id === 'marta-board-past' ? 36 : 28),
      pastSameType: pastBoards(today),
      howWeMeasure,
    };
  }
  if (id === 'marta-piotr-friday') {
    const friday = findWeekday(addDays(today, -1), 'Friday', -1);
    return {
      meeting: { id, title: '1:1 with Piotr', type: 'one_on_one', start: at(friday, '16:30'), end: at(friday, '17:00'), attendees: [piotr], isGroup: false },
      measured: { load: 58, excessStress: 20, recoveryTailMin: 25, validSamples: 8, signal: 'stress', recoveredAt: at(friday, '17:25') },
      insufficientReason: null,
      predicted: null,
      trace: traceFor(friday, '16:30', '17:00', 20),
      pastSameType: [],
      howWeMeasure,
    };
  }
  return null;
};

const pendingFor = (key: UserKey, now = new Date()): readonly PendingCheckInDto[] => {
  if (key !== 'marta' || state.reflections['marta-piotr-friday'] !== undefined) return [];
  const friday = findWeekday(addDays(todayInWarsaw(now), -1), 'Friday', -1);
  return [{ meetingId: 'marta-piotr-friday', title: '1:1 with Piotr', start: at(friday, '16:30'), end: at(friday, '17:00'), attendees: [piotr] }];
};

const energyFor = (key: UserKey): EnergyMapDto => ({
  computedAt: new Date().toISOString(),
  people: key === 'marta' ? energyPeople() : [],
  belowThresholdCount: key === 'marta' ? 21 : 0,
});

export const mockStore = {
  users: () => users,
  isUser,
  briefing: briefingFor,
  week: weekFor,
  meeting: meetingFor,
  energy: energyFor,
  pending: pendingFor,
  accept(key: UserKey, actionId: string): AcceptActionResultDto | null {
    const briefing = briefingFor(key);
    const action = briefing.actions.find(item => item.id === actionId);
    if (!action) return null;
    if (!state.accepted.includes(actionId)) state = { ...state, accepted: [...state.accepted, actionId] };
    write();
    const next = briefingFor(key);
    const today = todayInWarsaw();
    const tomorrow = addDays(today, 1);
    const block = key === 'marta' ? (blocksFor(today, tomorrow).find(item => item.actionId === actionId) ?? null) : null;
    return { actionId, block, projected: next.projected ?? next.outlook };
  },
  reflect(key: UserKey, meetingId: string, rating: Rating): ReflectionResultDto | null {
    if (key !== 'marta' || meetingId !== 'marta-piotr-friday') return null;
    state = { ...state, reflections: { ...state.reflections, [meetingId]: rating } };
    write();
    const updated = energyPeople().filter(entry => entry.person.id === 'piotr');
    const message =
      rating === 1
        ? 'You felt energized. Your body disagreed: stress was about 20 points above your baseline.'
        : rating === -1
          ? 'You felt drained. Your body agreed: stress stayed about 20 points above your baseline.'
          : 'You felt neutral. Your body disagreed: stress was about 20 points above your baseline.';
    return { meetingId, rating, message, updated };
  },
  pushSamples(key: UserKey): { count: number; at: string } {
    if (key !== 'jakub') return { count: 0, at: new Date().toISOString() };
    const atTime = new Date().toISOString();
    const point: LivePointDto = { t: atTime, stress: 64, heartRate: 91 };
    state = { ...state, extraPoints: [...state.extraPoints, point], lastSyncAt: atTime };
    write();
    return { count: 18, at: atTime };
  },
};
