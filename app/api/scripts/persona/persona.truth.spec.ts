import { describe, expect, test } from 'bun:test';
import {
  FUTURE_WEEKDAY_TEMPLATES,
  HISTORY_MEETING_GROUPS,
  MEETING_TYPES,
  PEOPLE,
  SCORED_PEOPLE,
  TODAY_STATE,
  TOMORROW,
  personById,
} from './persona.truth';

const historyMeetingsOf = (personId: string): number =>
  HISTORY_MEETING_GROUPS.filter((g) => g.attendeeIds.includes(personId)).reduce((sum, g) => sum + g.count, 0);

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

describe('meeting types (happy-path.md "Injected ground truth")', () => {
  test.each([
    ['board', 70, 80, 3],
    ['investor', 65, 72, 8],
    ['customer', 50, 45, 10],
    ['interview', 45, 50, 9],
    ['one_on_one', 35, 35, 12],
    ['product_review', 40, 40, 6],
    ['mentor', 35, 35, 4],
    ['standup', 15, 15, 30],
  ] as const)('%s: prior %d, true load %d, %d meetings in 42 days', (type, prior, trueLoad, count) => {
    expect(MEETING_TYPES[type]).toMatchObject({ prior, trueLoad, historyCount: count });
  });

  test('meeting groups add up to the per-type counts', () => {
    Object.entries(MEETING_TYPES).forEach(([type, truth]) => {
      const total = HISTORY_MEETING_GROUPS.filter((g) => g.type === type).reduce((sum, g) => sum + g.count, 0);
      expect(total).toBe(truth.historyCount);
    });
  });

  test('standups are the only group events and have no attendees', () => {
    HISTORY_MEETING_GROUPS.forEach((g) => {
      expect(g.isGroup).toBe(g.type === 'standup');
      if (g.isGroup) expect(g.attendeeIds).toEqual([]);
    });
  });

  test('every group references known people', () => {
    HISTORY_MEETING_GROUPS.flatMap((g) => g.attendeeIds).forEach((id) => expect(personById(id)).toBeDefined());
  });
});

describe('people', () => {
  test.each([
    ['Anna Kowalska', 'Lead investor', 6, 18, 'known_drain'],
    ['Piotr Nowak', 'Co-founder, CTO', 15, 15, 'hidden_drain'],
    ['Ola Wiśniewska', 'Head of Product', 12, -8, 'energizer'],
    ['Tomasz Lewandowski', 'Customer (bank)', 4, 1, 'overestimated'],
    ['Kasia Wójcik', 'Independent board member', 5, 0, 'neutral'],
  ] as const)('%s (%s): %d meetings, true effect %d, group %s', (name, role, meetings, effect, group) => {
    const person = SCORED_PEOPLE.find((p) => p.name === name);
    expect(person).toMatchObject({ role, trueEffect: effect, expectedGroup: group });
    expect(historyMeetingsOf(person?.id ?? '')).toBe(meetings);
  });

  test('21 one-off people have 1-2 history meetings each, Ewa Mazur 2', () => {
    const oneOffs = PEOPLE.filter((p) => p.kind === 'one_off');
    expect(oneOffs).toHaveLength(21);
    oneOffs.forEach((p) => expect([1, 2]).toContain(historyMeetingsOf(p.id)));
    expect(historyMeetingsOf(oneOffs.find((p) => p.name === 'Ewa Mazur')?.id ?? '')).toBe(2);
  });

  test('future-only people have no history meetings', () => {
    PEOPLE.filter((p) => p.kind === 'future').forEach((p) => expect(historyMeetingsOf(p.id)).toBe(0));
  });

  test('ids and first names are unique (the engine explains by first name)', () => {
    expect(new Set(PEOPLE.map((p) => p.id)).size).toBe(PEOPLE.length);
    expect(new Set(PEOPLE.map((p) => p.name.split(' ')[0])).size).toBe(PEOPLE.length);
  });

  test.each(['investor', 'customer', 'interview'] as const)(
    'one-off effects average to zero within %s, so they do not bias the type effect',
    (type) => {
      const effects = HISTORY_MEETING_GROUPS.filter(
        (g) => g.type === type && g.attendeeIds.every((id) => personById(id)?.kind === 'one_off'),
      ).flatMap((g) => g.attendeeIds.map((id) => personById(id)?.trueEffect ?? Number.NaN));
      expect(effects.length).toBeGreaterThan(0);
      expect(Math.abs(mean(effects))).toBeLessThan(0.01);
    },
  );
});

describe('reflections', () => {
  const reflected = HISTORY_MEETING_GROUPS.filter((g) => g.reflections.length > 0);

  test('each multiset covers every meeting of its group, except the pending 1:1 with Piotr', () => {
    reflected.forEach((g) => expect(g.reflections.length).toBe(g.count - (g.includesPendingCheckIn ? 1 : 0)));
    expect(HISTORY_MEETING_GROUPS.filter((g) => g.includesPendingCheckIn)).toHaveLength(1);
  });

  test('groups with only one-off attendees have no reflections', () => {
    HISTORY_MEETING_GROUPS.filter((g) => !g.attendeeIds.some((id) => personById(id)?.kind === 'scored')).forEach((g) =>
      expect(g.reflections).toEqual([]),
    );
  });

  test.each([
    ['anna-kowalska', (felt: number) => felt <= -0.25],
    ['piotr-nowak', (felt: number) => felt > -0.25],
    ['ola-wisniewska', (felt: number) => felt >= 0.25],
    ['tomasz-lewandowski', (felt: number) => felt <= -0.25],
    ['kasia-wojcik', (felt: number) => felt > -0.25 && felt < 0.25],
  ] as const)('mean felt of %s lands in its energy-map band', (personId, inBand) => {
    const ratings = reflected.filter((g) => g.attendeeIds.includes(personId)).flatMap((g) => g.reflections);
    expect(inBand(mean(ratings))).toBe(true);
  });
});

describe("Marta's state on demo day", () => {
  test('last night 6h05 and every 7-night window over the last 8 nights averages 6h05', () => {
    const minutes = TODAY_STATE.recentAsleepMin;
    expect(minutes[0]).toBe(365);
    expect(mean(minutes.slice(0, 7))).toBeCloseTo(365, 6);
    expect(mean(minutes.slice(1, 8))).toBeCloseTo(365, 6);
  });

  test('HRV factors of the 7 nights before last night average 1', () => {
    expect(TODAY_STATE.recentHrvFactors).toHaveLength(7);
    expect(mean(TODAY_STATE.recentHrvFactors)).toBeCloseTo(1, 6);
  });

  test('targets from the happy path', () => {
    expect(TODAY_STATE).toMatchObject({
      lastNightHrvRatio: 0.9,
      bodyBatteryAtWake: 41,
      medianWakeMinute: 6 * 60 + 30,
      resilience: 75,
    });
  });
});

describe("Marta's tomorrow (happy-path.md)", () => {
  test('matches the table exactly', () => {
    expect(TOMORROW.map(({ kind, title, start, end }) => [kind, title, start, end])).toEqual([
      ['meeting', 'Standup', '09:00', '09:15'],
      ['meeting', 'Board meeting', '10:00', '12:00'],
      ['meeting', '1:1 with Piotr', '12:00', '12:30'],
      ['meeting', 'Investor call', '14:00', '15:00'],
      ['meeting', 'Customer call', '16:30', '17:00'],
      ['workout', 'Run: intervals 6 x 800 m', '18:30', '19:30'],
    ]);
  });

  test('attendees and types', () => {
    const meetings = TOMORROW.flatMap((e) => (e.kind === 'meeting' ? [e] : []));
    expect(meetings.map((m) => [m.type, m.attendeeIds])).toEqual([
      ['standup', []],
      ['board', ['anna-kowalska', 'kasia-wojcik', 'piotr-nowak']],
      ['one_on_one', ['piotr-nowak']],
      ['investor', ['anna-kowalska', 'michal-zielinski']],
      ['customer', ['tomasz-lewandowski']],
    ]);
    expect(personById('michal-zielinski')).toMatchObject({ name: 'Michał Zieliński', kind: 'future' });
  });
});

describe('future weekday templates', () => {
  test('use known people and never schedule on top of each other', () => {
    FUTURE_WEEKDAY_TEMPLATES.forEach((template) => {
      template.forEach((m) => m.attendeeIds.forEach((id) => expect(personById(id)).toBeDefined()));
      const sorted = [...template].sort((a, b) => a.start.localeCompare(b.start));
      sorted.slice(1).forEach((m, i) => expect(m.start >= (sorted[i]?.end ?? '')).toBe(true));
    });
  });
});
