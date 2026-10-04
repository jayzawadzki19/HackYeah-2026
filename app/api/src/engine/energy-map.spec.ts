import { describe, expect, test } from 'bun:test';
import { ENGINE_CONFIG } from './engine.config';
import { energyMap } from './energy-map';
import { fitLoadModel, type LoadModel } from './load-model';
import { meeting } from './testing/builders';
import type { EngineMeeting, EnginePerson, MeetingType, Rating, Reflection } from './types';

const PEOPLE: readonly EnginePerson[] = [
  { id: 'anna', name: 'Anna Kowalska', role: 'Lead investor' },
  { id: 'piotr', name: 'Piotr Nowak', role: 'CTO' },
  { id: 'ola', name: 'Ola Wiśniewska', role: 'Head of Product' },
  { id: 'tomasz', name: 'Tomasz Lewandowski', role: 'Customer' },
  { id: 'kasia', name: 'Kasia Wójcik', role: 'Board member' },
  { id: 'ewa', name: 'Ewa Mazur', role: 'Mentor' },
  { id: 'jan', name: 'Jan Nowicki', role: 'Candidate' },
];

const baseModel = fitLoadModel([], ENGINE_CONFIG);
const modelWith = (
  effects: Readonly<Record<string, number>>,
  overrides: Partial<Pick<LoadModel, 'typeEffects' | 'personResidualSd'>> = {},
): LoadModel => ({
  ...baseModel,
  ...overrides,
  personEffects: new Map(Object.entries(effects)),
});

let seq = 0;
const meetingsWith = (personId: string, count: number, type: MeetingType = 'one_on_one'): EngineMeeting[] =>
  Array.from({ length: count }, () => meeting({ id: `${personId}-${++seq}`, type, attendeeIds: [personId], start: 0, end: 1 }));

const reflect = (meetings: readonly EngineMeeting[], ratings: readonly Rating[]): Reflection[] =>
  meetings.flatMap((m, i) => (ratings[i] === undefined ? [] : [{ meetingId: m.id, rating: ratings[i]! }]));

describe('energyMap', () => {
  const anna = meetingsWith('anna', 6, 'investor');
  const piotr = meetingsWith('piotr', 6);
  const ola = meetingsWith('ola', 6);
  const tomasz = meetingsWith('tomasz', 4, 'customer');
  const kasia = [...meetingsWith('kasia', 3, 'board'), ...meetingsWith('kasia', 2, 'mentor')];
  const meetings = [...anna, ...piotr, ...ola, ...tomasz, ...kasia];
  const reflections = [
    ...reflect(anna, [-1, -1, -1, 0]),
    ...reflect(piotr, [0, 1, 0, 1]),
    ...reflect(ola, [1, 1, 1]),
    ...reflect(tomasz, [-1, -1, 0]),
    ...reflect(kasia, [0, 0]),
  ];
  const model = modelWith(
    { anna: 10, piotr: 10.2, ola: -6.6, tomasz: -0.7, kasia: 1.4 },
    { typeEffects: { ...baseModel.typeEffects, board: 77 } },
  );
  const map = energyMap(model, meetings, reflections, PEOPLE, ENGINE_CONFIG);
  const entry = (id: string) => map.entries.find((e) => e.person.id === id)!;

  test('places the happy-path people in their groups', () => {
    expect(entry('anna').group).toBe('known_drain');
    expect(entry('piotr').group).toBe('hidden_drain');
    expect(entry('ola').group).toBe('energizer');
    expect(entry('tomasz').group).toBe('overestimated');
    expect(entry('kasia').group).toBe('neutral');
  });

  test('explains each group with the plan templates', () => {
    expect(entry('anna').explanation).toBe('Meetings with Anna cost you about +10 points, and you feel it too.');
    expect(entry('piotr').explanation).toBe('Meetings with Piotr cost you about +10 points more than they feel.');
    expect(entry('ola').explanation).toBe('Meetings with Ola lower your stress load (about 7 points).');
    expect(entry('tomasz').explanation).toBe('Meetings with Tomasz feel draining, but your body stays calm.');
    expect(entry('kasia').explanation).toBe('Board meetings are demanding for you; Kasia is not the reason.');
  });

  test('reports meetings, body effect, felt and reflection counts', () => {
    expect(entry('piotr')).toMatchObject({ meetings: 6, bodyEffect: 10.2, felt: 0.5, reflections: 4 });
    expect(entry('tomasz')).toMatchObject({ meetings: 4, felt: -0.67, reflections: 3 });
  });

  test('orders entries by body effect, highest first', () => {
    expect(map.entries.map((e) => e.person.id)).toEqual(['piotr', 'anna', 'kasia', 'tomasz', 'ola']);
  });

  test('does not score people below MIN_MEETINGS_PER_PERSON but counts those with 1-2 meetings', () => {
    const extra = [...meetingsWith('ewa', 2, 'mentor'), ...meetingsWith('jan', 1, 'interview')];
    const result = energyMap(modelWith({ ewa: 3, jan: 1 }), extra, [], PEOPLE, ENGINE_CONFIG);
    expect(result.entries).toEqual([]);
    expect(result.belowThresholdCount).toBe(2);
  });

  test('group meetings never count toward a person', () => {
    const standups = Array.from({ length: 5 }, (_, i) =>
      meeting({ id: `s${i}`, type: 'standup', isGroup: true, attendeeIds: ['ewa'], start: 0, end: 1 }),
    );
    const result = energyMap(modelWith({}), standups, [], PEOPLE, ENGINE_CONFIG);
    expect(result).toEqual({ entries: [], belowThresholdCount: 0 });
  });

  test('applies the thresholds at their boundaries', () => {
    const people = ['anna', 'piotr', 'ola', 'tomasz'];
    const ms = people.flatMap((p) => meetingsWith(p, 4));
    const byPerson = (p: string) => ms.filter((m) => m.attendeeIds.includes(p));
    const result = energyMap(
      modelWith({ anna: 4, piotr: 3.9, ola: -3, tomasz: 0 }),
      ms,
      [
        ...reflect(byPerson('anna'), [-1, 0, 0, 0]),
        ...reflect(byPerson('piotr'), [0]),
        ...reflect(byPerson('ola'), [0]),
        ...reflect(byPerson('tomasz'), [1, 0, 0, 0]),
      ],
      PEOPLE,
      ENGINE_CONFIG,
    );
    const group = (id: string) => result.entries.find((e) => e.person.id === id)!.group;
    expect(group('anna')).toBe('known_drain');
    expect(group('piotr')).toBe('neutral');
    expect(group('ola')).toBe('energizer');
    expect(group('tomasz')).toBe('energizer');
  });

  test('without reflections felt is null and the person is grouped by the body effect alone', () => {
    const ms = [...meetingsWith('anna', 3), ...meetingsWith('ola', 3), ...meetingsWith('kasia', 3)];
    const result = energyMap(modelWith({ anna: 9, ola: -5, kasia: 1 }), ms, [], PEOPLE, ENGINE_CONFIG);
    const get = (id: string) => result.entries.find((e) => e.person.id === id)!;
    expect(get('anna')).toMatchObject({ felt: null, reflections: 0, group: 'hidden_drain' });
    expect(get('ola').group).toBe('energizer');
    expect(get('kasia').explanation).toBe('Meetings with Kasia have no measurable effect either way.');
  });

  test('an energizer whose body effect is not negative is not described as lowering stress', () => {
    const ms = meetingsWith('ola', 3);
    const result = energyMap(modelWith({ ola: 2 }), ms, reflect(ms, [1, 1]), PEOPLE, ENGINE_CONFIG);
    expect(result.entries[0]).toMatchObject({
      group: 'energizer',
      explanation: 'Meetings with Ola feel energizing and cost you almost nothing.',
    });
  });

  test('confidence is high with 6+ meetings and a residual sd of at most 10, medium otherwise', () => {
    const ms = [...meetingsWith('anna', 6), ...meetingsWith('piotr', 6), ...meetingsWith('ola', 3)];
    const result = energyMap(
      modelWith({ anna: 5, piotr: 5, ola: 5 }, { personResidualSd: new Map([['anna', 8], ['piotr', 12], ['ola', 2]]) }),
      ms,
      [],
      PEOPLE,
      ENGINE_CONFIG,
    );
    const confidence = (id: string) => result.entries.find((e) => e.person.id === id)!.confidence;
    expect(confidence('anna')).toBe('high');
    expect(confidence('piotr')).toBe('medium');
    expect(confidence('ola')).toBe('medium');
  });

  test('ignores reflections of meetings the person did not attend', () => {
    const annaMeetings = meetingsWith('anna', 3);
    const other = meetingsWith('ola', 1);
    const result = energyMap(modelWith({ anna: 6, ola: 0 }), [...annaMeetings, ...other], reflect(other, [-1]), PEOPLE, ENGINE_CONFIG);
    expect(result.entries.find((e) => e.person.id === 'anna')).toMatchObject({ felt: null, reflections: 0 });
  });

  test('falls back to the id when a person is missing from the people list', () => {
    const ms = meetingsWith('ghost', 3);
    const result = energyMap(modelWith({ ghost: 0 }), ms, [], PEOPLE, ENGINE_CONFIG);
    expect(result.entries[0]!.person).toEqual({ id: 'ghost', name: 'ghost', role: null });
  });
});
