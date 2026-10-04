/**
 * Ground truth for the synthetic persona Marta (docs/happy-path.md, "Persona fixture - Marta").
 * The generator injects these effects; the engine never sees this file and must recover them from data.
 * The engine validation test imports it to assert recovery.
 */
import type { EnergyGroup, MeetingType, Rating, WorkoutIntensity } from '../../src/engine/types';

export type PersonaMeetingType = Exclude<MeetingType, 'pitch' | 'team_sync'>;

export interface MeetingTypeTruth {
  /** population default the engine starts from (TYPE_PRIORS) */
  readonly prior: number;
  /** Marta's injected load for this format */
  readonly trueLoad: number;
  /** meetings of this type in the 42 history days */
  readonly historyCount: number;
}

export const MEETING_TYPES: Readonly<Record<PersonaMeetingType, MeetingTypeTruth>> = {
  board: { prior: 70, trueLoad: 80, historyCount: 3 },
  investor: { prior: 65, trueLoad: 72, historyCount: 8 },
  customer: { prior: 50, trueLoad: 45, historyCount: 10 },
  interview: { prior: 45, trueLoad: 50, historyCount: 9 },
  one_on_one: { prior: 35, trueLoad: 35, historyCount: 12 },
  product_review: { prior: 40, trueLoad: 40, historyCount: 6 },
  mentor: { prior: 35, trueLoad: 35, historyCount: 4 },
  standup: { prior: 15, trueLoad: 15, historyCount: 30 },
};

export const MODIFIERS = {
  /** gap to the previous meeting of 5 min or less */
  backToBackGapMin: 5,
  backToBack: 8,
  lateStartHour: 16,
  lateStart: 5,
} as const;

/** true load = type load + mean(attendee effects) + modifiers + gaussian(0, LOAD_NOISE_SD) */
export const LOAD_NOISE_SD = 3;

/**
 * Noise pinned for the two meetings the demo shows in detail, so their numbers do not depend on the draw:
 * the most recent board meeting is 80 + 11 - 1 = 90 (excess 36, tail 45 min), and the pending 1:1 with Piotr
 * is 35 + 15 + 5 - 4 = 51 (excess about 20, so the reflection message says "about 20 points").
 */
export const PINNED_LOAD_NOISE = { mostRecentBoard: -1, pendingCheckIn: -4 } as const;

export type PersonKind = 'scored' | 'one_off' | 'future';

export interface PersonTruth {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly kind: PersonKind;
  /** injected body effect in load points (+ drains, - energizes); 0 for future-only people */
  readonly trueEffect: number;
  readonly expectedGroup: EnergyGroup | null;
}

const scored = (id: string, name: string, role: string, trueEffect: number, expectedGroup: EnergyGroup): PersonTruth => ({
  id,
  name,
  role,
  kind: 'scored',
  trueEffect,
  expectedGroup,
});

const oneOff = (id: string, name: string, role: string, trueEffect: number): PersonTruth => ({
  id,
  name,
  role,
  kind: 'one_off',
  trueEffect,
  expectedGroup: null,
});

const future = (id: string, name: string, role: string): PersonTruth => ({
  id,
  name,
  role,
  kind: 'future',
  trueEffect: 0,
  expectedGroup: null,
});

export const SCORED_PEOPLE: readonly PersonTruth[] = [
  scored('anna-kowalska', 'Anna Kowalska', 'Lead investor', 18, 'known_drain'),
  scored('piotr-nowak', 'Piotr Nowak', 'Co-founder, CTO', 15, 'hidden_drain'),
  scored('ola-wisniewska', 'Ola Wiśniewska', 'Head of Product', -8, 'energizer'),
  scored('tomasz-lewandowski', 'Tomasz Lewandowski', 'Customer (bank)', 1, 'overestimated'),
  scored('kasia-wojcik', 'Kasia Wójcik', 'Independent board member', 0, 'neutral'),
];

const FUND_PARTNERS: readonly PersonTruth[] = [
  oneOff('jan-kaminski', 'Jan Kamiński', 'Partner, Vistula Ventures', 4),
  oneOff('magdalena-zajac', 'Magdalena Zając', 'Partner, Baltic Seed Fund', -3),
  oneOff('krzysztof-szymanski', 'Krzysztof Szymański', 'Principal, Odra Capital', 2),
  oneOff('agnieszka-wozniak', 'Agnieszka Woźniak', 'Partner, Tatra VC', -1),
  oneOff('pawel-dabrowski', 'Paweł Dąbrowski', 'Partner, Mazovia Growth', -2),
];

const CUSTOMERS: readonly PersonTruth[] = [
  oneOff('marek-kozlowski', 'Marek Kozłowski', 'Head of IT, logistics company (customer)', 3),
  oneOff('joanna-jankowska', 'Joanna Jankowska', 'COO, retail chain (customer)', -2),
  oneOff('rafal-wojciechowski', 'Rafał Wojciechowski', 'CTO, insurer (customer)', 1),
  oneOff('natalia-kwiatkowska', 'Natalia Kwiatkowska', 'Procurement lead, telecom (customer)', -4),
  oneOff('bartosz-krawczyk', 'Bartosz Krawczyk', 'Founder, e-commerce brand (customer)', 2),
  oneOff('monika-piotrowska', 'Monika Piotrowska', 'Head of Operations, energy company (customer)', 0),
];

const CANDIDATES: readonly PersonTruth[] = [
  oneOff('adam-grabowski', 'Adam Grabowski', 'Candidate - Senior Backend Engineer', 3),
  oneOff('karolina-pawlowska', 'Karolina Pawłowska', 'Candidate - Product Designer', -2),
  oneOff('wojciech-michalski', 'Wojciech Michalski', 'Candidate - Data Engineer', 0),
  oneOff('zofia-krol', 'Zofia Król', 'Candidate - Head of Sales', 4),
  oneOff('mateusz-wieczorek', 'Mateusz Wieczorek', 'Candidate - Frontend Engineer', -3),
  oneOff('alicja-jablonska', 'Alicja Jabłońska', 'Candidate - Customer Success Manager', 1),
  oneOff('dawid-majewski', 'Dawid Majewski', 'Candidate - DevOps Engineer', -1),
  oneOff('weronika-olszewska', 'Weronika Olszewska', 'Candidate - Marketing Lead', -4),
  oneOff('kamil-stepien', 'Kamil Stępień', 'Candidate - Mobile Engineer', 2),
];

const EWA = oneOff('ewa-mazur', 'Ewa Mazur', 'Mentor', 1);

const FUTURE_PEOPLE: readonly PersonTruth[] = [
  future('michal-zielinski', 'Michał Zieliński', 'Partner, Wisła Capital (new fund, first meeting)'),
  future('igor-malinowski', 'Igor Malinowski', 'Candidate - ML Engineer'),
  future('julia-sikora', 'Julia Sikora', 'Candidate - QA Engineer'),
  future('filip-kaczmarek', 'Filip Kaczmarek', 'Candidate - Backend Engineer'),
  future('hanna-wrobel', 'Hanna Wróbel', 'Candidate - Data Scientist'),
  future('ewelina-gorska', 'Ewelina Górska', 'Head of Digital, pharma company (customer)'),
  future('grzegorz-baran', 'Grzegorz Baran', 'Head of Payments, fintech (customer)'),
  future('szymon-pietrzak', 'Szymon Pietrzak', 'Partner, Carpathia Ventures'),
];

export const PEOPLE: readonly PersonTruth[] = [
  ...SCORED_PEOPLE,
  EWA,
  ...FUND_PARTNERS,
  ...CUSTOMERS,
  ...CANDIDATES,
  ...FUTURE_PEOPLE,
];

const peopleById = new Map(PEOPLE.map((p) => [p.id, p]));

export const personById = (id: string): PersonTruth | undefined => peopleById.get(id);

export interface MeetingGroupTruth {
  /** stable fragment for event ids */
  readonly key: string;
  readonly type: PersonaMeetingType;
  readonly title: string;
  readonly attendeeIds: readonly string[];
  readonly isGroup: boolean;
  readonly count: number;
  readonly durationMin: number;
  /** seeded reflection ratings, one per meeting (shuffled by the schedule); empty = no reflections */
  readonly reflections: readonly Rating[];
  /** the group holds the pending check-in (most recent weekday's last meeting, no reflection) */
  readonly includesPendingCheckIn: boolean;
}

const group = (
  key: string,
  type: PersonaMeetingType,
  title: string,
  attendeeIds: readonly string[],
  count: number,
  durationMin: number,
  reflections: readonly Rating[] = [],
): MeetingGroupTruth => ({
  key,
  type,
  title,
  attendeeIds,
  isGroup: false,
  count,
  durationMin,
  reflections,
  includesPendingCheckIn: false,
});

const company = (person: PersonTruth): string => person.role.split(', ')[1] ?? person.role;

/**
 * Who Marta met in the 42 history days. Reflections are per meeting, so a board rating is shared by Anna,
 * Kasia and Piotr; the multisets are chosen so every scored person's mean lands in their energy-map band
 * (Anna -0.67, Piotr +0.36, Ola +0.75, Tomasz -0.75, Kasia 0).
 */
export const HISTORY_MEETING_GROUPS: readonly MeetingGroupTruth[] = [
  { ...group('standup', 'standup', 'Standup', [], 30, 15), isGroup: true },
  group('board', 'board', 'Board meeting', ['anna-kowalska', 'kasia-wojcik', 'piotr-nowak'], 3, 120, [-1, 0, 0]),
  group('investor-anna', 'investor', 'Investor update with Anna', ['anna-kowalska'], 3, 60, [-1, -1, -1]),
  ...FUND_PARTNERS.map((p) => group(`investor-${p.id}`, 'investor', `Investor call - ${company(p)}`, [p.id], 1, 60)),
  group('customer-tomasz', 'customer', 'Customer call with Tomasz', ['tomasz-lewandowski'], 4, 30, [-1, -1, 0, -1]),
  ...CUSTOMERS.map((p, i) => group(`customer-${p.id}`, 'customer', `Customer call - ${p.name}`, [p.id], 1, i < 3 ? 30 : 60)),
  ...CANDIDATES.map((p) => group(`interview-${p.id}`, 'interview', `Interview - ${p.name}`, [p.id], 1, 60)),
  {
    ...group('one-on-one-piotr', 'one_on_one', '1:1 with Piotr', ['piotr-nowak'], 6, 30, [0, 1, 0, 1, 0]),
    includesPendingCheckIn: true,
  },
  group('one-on-one-ola', 'one_on_one', '1:1 with Ola', ['ola-wisniewska'], 6, 30, [1, 1, 0, 1, 1, 1]),
  group('product-review', 'product_review', 'Product review', ['ola-wisniewska', 'piotr-nowak'], 6, 60, [1, 1, 0, 1, 1, 0]),
  group('mentor-kasia', 'mentor', 'Mentor session with Kasia', ['kasia-wojcik'], 2, 60, [0, 1]),
  group('mentor-ewa', 'mentor', 'Mentor session with Ewa', [EWA.id], 2, 60),
];

export const TRAINING = {
  start: '18:30',
  end: '19:30',
  runsPerWeek: 3,
  /** history occasions of hard intervals the evening before a heavy (board) day */
  hardBeforeHeavyOccasions: 3,
  /** next-night HRV relative to the mean of the 7 nights before */
  hrvFactorAfterHardBeforeHeavy: 0.85,
} as const;

export const WORKOUT_TITLES: Readonly<Record<WorkoutIntensity, string>> = {
  easy: 'Run: easy 8 km',
  tempo: 'Run: tempo 3 x 2 km',
  intervals: 'Run: intervals 6 x 800 m',
  long: 'Run: long 16 km',
};

/** "Marta's state on demo day". Index 0 = last night, 1 = the night before, and so on. */
export const TODAY_STATE = {
  /** asleep minutes of the last 8 nights; any 7 consecutive of them average 365 (6h05) */
  recentAsleepMin: [365, 350, 380, 360, 370, 355, 375, 365],
  lastNightHrvRatio: 0.9,
  /**
   * HRV factors (x personal mean) of nights 1-7 before last night: high over the previous weekend, then a
   * steady slide. Smooth on purpose: open-wearables averages HRV per UTC calendar day, which splits each night
   * at UTC midnight, and a smooth pattern keeps both that CV and the per-night CV about 15% (resilience about 75).
   */
  recentHrvFactors: [0.78, 0.86, 0.94, 1.02, 1.12, 1.2, 1.08],
  personalHrvMs: 55,
  bodyBatteryAtWake: 41,
  /** 06:30 */
  medianWakeMinute: 390,
  resilience: 75,
} as const;

export type PlannedEvent =
  | {
      readonly kind: 'meeting';
      readonly title: string;
      readonly type: PersonaMeetingType;
      readonly start: string;
      readonly end: string;
      readonly attendeeIds: readonly string[];
      readonly isGroup: boolean;
    }
  | {
      readonly kind: 'workout';
      readonly title: string;
      readonly intensity: WorkoutIntensity;
      readonly start: string;
      readonly end: string;
    };

export type PlannedMeeting = Extract<PlannedEvent, { kind: 'meeting' }>;

const meeting = (
  title: string,
  type: PersonaMeetingType,
  start: string,
  end: string,
  attendeeIds: readonly string[],
): PlannedMeeting => ({ kind: 'meeting', title, type, start, end, attendeeIds, isGroup: type === 'standup' });

/** "Marta's tomorrow (the heavy day)" */
export const TOMORROW: readonly PlannedEvent[] = [
  meeting('Standup', 'standup', '09:00', '09:15', []),
  meeting('Board meeting', 'board', '10:00', '12:00', ['anna-kowalska', 'kasia-wojcik', 'piotr-nowak']),
  meeting('1:1 with Piotr', 'one_on_one', '12:00', '12:30', ['piotr-nowak']),
  meeting('Investor call', 'investor', '14:00', '15:00', ['anna-kowalska', 'michal-zielinski']),
  meeting('Customer call', 'customer', '16:30', '17:00', ['tomasz-lewandowski']),
  { kind: 'workout', title: WORKOUT_TITLES.intervals, intensity: 'intervals', start: '18:30', end: '19:30' },
];

/**
 * Ordinary weekdays after tomorrow (a standup is added to each). Sized so the predicted day load stays
 * between 30 and 60 whether the engine trusts the history or the priors, which keeps Saturday (no meetings)
 * the first day light enough to take tomorrow's intervals.
 */
export const FUTURE_WEEKDAY_TEMPLATES: readonly (readonly PlannedMeeting[])[] = [
  [
    meeting('Product review', 'product_review', '10:00', '11:00', ['ola-wisniewska', 'piotr-nowak']),
    meeting('Interview - Igor Malinowski', 'interview', '13:30', '14:30', ['igor-malinowski']),
    meeting('1:1 with Ola', 'one_on_one', '15:00', '15:30', ['ola-wisniewska']),
    meeting('Customer call - Ewelina Górska', 'customer', '16:30', '17:30', ['ewelina-gorska']),
  ],
  [
    meeting('Interview - Julia Sikora', 'interview', '10:00', '11:00', ['julia-sikora']),
    meeting('Mentor session with Ewa', 'mentor', '12:00', '13:00', [EWA.id]),
    meeting('Investor call - Carpathia Ventures', 'investor', '14:00', '15:00', ['szymon-pietrzak']),
    meeting('1:1 with Piotr', 'one_on_one', '16:30', '17:00', ['piotr-nowak']),
  ],
  [
    meeting('Customer call with Tomasz', 'customer', '10:00', '11:00', ['tomasz-lewandowski']),
    meeting('Product review', 'product_review', '13:00', '14:00', ['ola-wisniewska', 'piotr-nowak']),
    meeting('Interview - Filip Kaczmarek', 'interview', '15:00', '16:00', ['filip-kaczmarek']),
    meeting('1:1 with Ola', 'one_on_one', '16:30', '17:00', ['ola-wisniewska']),
  ],
  [
    meeting('1:1 with Piotr', 'one_on_one', '10:00', '10:30', ['piotr-nowak']),
    meeting('Customer call - Grzegorz Baran', 'customer', '11:30', '12:30', ['grzegorz-baran']),
    meeting('Product review', 'product_review', '14:00', '15:00', ['ola-wisniewska', 'piotr-nowak']),
    meeting('Interview - Hanna Wróbel', 'interview', '16:00', '17:00', ['hanna-wrobel']),
  ],
];
