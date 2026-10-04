import { describe, expect, test } from 'bun:test';
import { ENGINE_CONFIG } from './engine.config';
import { basisLabel, fitLoadModel, predictMeetingLoad, type LoadObservation } from './load-model';
import type { MeetingModifiers } from './meeting-load';
import { meeting } from './testing/builders';
import type { EngineMeeting, MeetingType } from './types';

const NO_MODS: MeetingModifiers = { backToBack: false, lateStart: false };

let seq = 0;
const m = (type: MeetingType, attendeeIds: readonly string[], isGroup = false): EngineMeeting =>
  meeting({ id: `m${++seq}`, type, attendeeIds, isGroup, start: 0, end: 3_600_000 });

const obs = (meetingValue: EngineMeeting, load: number, modifiers: MeetingModifiers = NO_MODS): LoadObservation => ({
  meeting: meetingValue,
  load,
  modifiers,
});

describe('fitLoadModel', () => {
  test('cold start: type effects equal the population priors and nobody has an effect', () => {
    const model = fitLoadModel([], ENGINE_CONFIG);
    expect(model.typeEffects).toEqual(ENGINE_CONFIG.TYPE_PRIORS);
    expect(model.personEffects.size).toBe(0);
    expect(model.typeCounts.board).toBe(0);
  });

  test('shrinks a type effect toward its prior with SHRINKAGE_PSEUDO_MEETINGS pseudo meetings', () => {
    const boards = [91, 91, 91].map((load) => obs(m('board', [], true), load));
    expect(fitLoadModel(boards, ENGINE_CONFIG).typeEffects.board).toBeCloseTo((3 * 91 + 3 * 70) / 6, 9);
  });

  test('subtracts modifiers as fixed known offsets before fitting', () => {
    const boards = [99, 99, 99].map((load) => obs(m('board', [], true), load, { backToBack: true, lateStart: false }));
    expect(fitLoadModel(boards, ENGINE_CONFIG).typeEffects.board).toBeCloseTo(80.5, 9);
  });

  test('group meetings feed type effects only, never person effects', () => {
    const model = fitLoadModel([obs(m('standup', ['team', 'ola'], true), 30)], ENGINE_CONFIG);
    expect(model.personEffects.size).toBe(0);
    expect(model.personCounts.size).toBe(0);
    expect(model.typeCounts.standup).toBe(1);
  });

  test('jointly shrinks type and person effects (ridge closed form for one meeting)', () => {
    const model = fitLoadModel([obs(m('one_on_one', ['piotr']), 55)], ENGINE_CONFIG);
    expect(model.typeEffects.one_on_one).toBeCloseTo(39, 9);
    expect(model.personEffects.get('piotr')).toBeCloseTo(4, 9);
  });

  test('a person enters as the mean over attendees', () => {
    const model = fitLoadModel([obs(m('product_review', ['ola', 'piotr']), 52)], ENGINE_CONFIG);
    const effects = [model.personEffects.get('ola')!, model.personEffects.get('piotr')!];
    expect(effects[0]).toBeCloseTo(effects[1]!, 9);
    const fitted = model.typeEffects.product_review + (effects[0]! + effects[1]!) / 2;
    expect(fitted).toBeGreaterThan(40);
    expect(fitted).toBeLessThan(52);
  });

  test('counts measured meetings per type and per person', () => {
    const model = fitLoadModel(
      [obs(m('one_on_one', ['piotr']), 50), obs(m('one_on_one', ['piotr']), 52), obs(m('mentor', ['kasia']), 35)],
      ENGINE_CONFIG,
    );
    expect(model.typeCounts.one_on_one).toBe(2);
    expect(model.personCounts.get('piotr')).toBe(2);
    expect(model.personCounts.get('kasia')).toBe(1);
  });

  test('residual sd per person needs at least two meetings', () => {
    const model = fitLoadModel(
      [obs(m('one_on_one', ['piotr']), 40), obs(m('one_on_one', ['piotr']), 60), obs(m('mentor', ['kasia']), 35)],
      ENGINE_CONFIG,
    );
    expect(model.personResidualSd.get('piotr')).toBeCloseTo(Math.SQRT2 * 10, 6);
    expect(model.personResidualSd.has('kasia')).toBe(false);
  });

  test('does not depend on observation order', () => {
    const list = [obs(m('one_on_one', ['piotr']), 50), obs(m('board', ['anna', 'piotr']), 90), obs(m('mentor', ['anna']), 44)];
    const a = fitLoadModel(list, ENGINE_CONFIG);
    const b = fitLoadModel([...list].reverse(), ENGINE_CONFIG);
    expect(b.personEffects.get('anna')).toBeCloseTo(a.personEffects.get('anna')!, 9);
    expect(b.typeEffects.board).toBeCloseTo(a.typeEffects.board, 9);
  });
});

describe('recovers the happy-path ground truth (noise-free truth table)', () => {
  const TYPE_TRUTH: Partial<Record<MeetingType, number>> = {
    board: 80,
    investor: 72,
    customer: 45,
    interview: 50,
    one_on_one: 35,
    product_review: 40,
    mentor: 35,
    standup: 15,
  };
  const ONE_OFF_EFFECTS = [3, -2, 5, -4, 1, 0, -3, 2, 4, -1, 2, -5, 3, 0, 1, -2, 4, -3, 2, -1];
  const PERSON_TRUTH = new Map<string, number>([
    ['anna', 18],
    ['piotr', 15],
    ['ola', -8],
    ['tomasz', 1],
    ['kasia', 0],
    ['ewa', 2],
    ...ONE_OFF_EFFECTS.map((e, i): [string, number] => [`oneoff${i}`, e]),
  ]);
  const B2B: MeetingModifiers = { backToBack: true, lateStart: false };
  const LATE: MeetingModifiers = { backToBack: false, lateStart: true };

  const truthLoad = (type: MeetingType, attendees: readonly string[], mods: MeetingModifiers, isGroup: boolean) =>
    TYPE_TRUTH[type]! +
    (isGroup ? 0 : attendees.reduce((acc, p) => acc + PERSON_TRUTH.get(p)!, 0) / attendees.length) +
    (mods.backToBack ? 8 : 0) +
    (mods.lateStart ? 5 : 0);

  const repeat = (n: number, type: MeetingType, attendees: (i: number) => readonly string[], mods: (i: number) => MeetingModifiers = () => NO_MODS, isGroup = false) =>
    Array.from({ length: n }, (_, i) => {
      const a = attendees(i);
      const mod = mods(i);
      return obs(m(type, a, isGroup), truthLoad(type, a, mod, isGroup), mod);
    });

  let oneOff = 0;
  const next = () => [`oneoff${oneOff++}`];
  const history = [
    ...repeat(3, 'board', () => ['anna', 'kasia', 'piotr']),
    ...repeat(3, 'investor', () => ['anna']),
    ...repeat(5, 'investor', next),
    ...repeat(4, 'customer', () => ['tomasz'], (i) => (i === 0 ? LATE : NO_MODS)),
    ...repeat(6, 'customer', next),
    ...repeat(9, 'interview', next),
    ...repeat(6, 'one_on_one', () => ['piotr'], (i) => (i < 2 ? B2B : NO_MODS)),
    ...repeat(6, 'one_on_one', () => ['ola'], (i) => (i === 0 ? LATE : NO_MODS)),
    ...repeat(6, 'product_review', () => ['ola', 'piotr']),
    ...repeat(2, 'mentor', () => ['kasia']),
    ...repeat(2, 'mentor', () => ['ewa']),
    ...repeat(30, 'standup', () => ['team'], () => NO_MODS, true),
  ];
  const model = fitLoadModel(history, ENGINE_CONFIG);
  const predict = (type: MeetingType, attendees: readonly string[], mods: MeetingModifiers = NO_MODS) =>
    predictMeetingLoad(model, m(type, attendees), mods, ENGINE_CONFIG).load;

  test('tomorrow predictions match the happy-path targets within +/- 5', () => {
    expect(Math.abs(predict('board', ['anna', 'kasia', 'piotr']) - 83)).toBeLessThanOrEqual(5);
    expect(Math.abs(predict('one_on_one', ['piotr'], B2B) - 56)).toBeLessThanOrEqual(5);
    expect(Math.abs(predict('investor', ['anna', 'michal']) - 76)).toBeLessThanOrEqual(5);
    expect(Math.abs(predict('customer', ['tomasz'], LATE) - 52)).toBeLessThanOrEqual(5);
    expect(Math.abs(predictMeetingLoad(model, m('standup', ['team'], true), NO_MODS, ENGINE_CONFIG).load - 15)).toBeLessThanOrEqual(1);
  });

  test('person effects land on the expected side of the energy-map thresholds', () => {
    const effect = (id: string) => model.personEffects.get(id)!;
    expect(effect('anna')).toBeGreaterThanOrEqual(4);
    expect(effect('piotr')).toBeGreaterThanOrEqual(4);
    expect(effect('ola')).toBeLessThanOrEqual(-3);
    expect(effect('tomasz')).toBeLessThan(4);
    expect(Math.abs(effect('kasia'))).toBeLessThan(3);
  });
});

describe('predictMeetingLoad', () => {
  test('cold start predicts the prior with a population-default label', () => {
    const prediction = predictMeetingLoad(fitLoadModel([], ENGINE_CONFIG), m('pitch', ['jury']), NO_MODS, ENGINE_CONFIG);
    expect(prediction).toEqual({
      load: 75,
      basis: { typeMeetings: 0, personMeetings: [{ personId: 'jury', meetings: 0 }] },
      label: 'Population default - no history yet',
    });
  });

  test('adds modifiers and rounds to a whole load', () => {
    const model = fitLoadModel([], ENGINE_CONFIG);
    expect(predictMeetingLoad(model, m('one_on_one', []), { backToBack: true, lateStart: true }, ENGINE_CONFIG).load).toBe(48);
  });

  test('clamps to 0-100', () => {
    const model = fitLoadModel([91, 99, 100, 100].map((load) => obs(m('pitch', [], true), load)), ENGINE_CONFIG);
    expect(predictMeetingLoad(model, m('pitch', []), NO_MODS, ENGINE_CONFIG).load).toBe(88);
    expect(predictMeetingLoad(model, m('pitch', []), { backToBack: true, lateStart: true }, ENGINE_CONFIG).load).toBe(100);
    const relief = { ...ENGINE_CONFIG, BACK_TO_BACK_PENALTY: -200 };
    expect(predictMeetingLoad(model, m('pitch', []), { backToBack: true, lateStart: false }, relief).load).toBe(0);
  });

  test('group meetings ignore attendees in the prediction and the basis', () => {
    const model = fitLoadModel([obs(m('one_on_one', ['piotr']), 80)], ENGINE_CONFIG);
    const prediction = predictMeetingLoad(model, m('standup', ['piotr'], true), NO_MODS, ENGINE_CONFIG);
    expect(prediction.load).toBe(15);
    expect(prediction.basis.personMeetings).toEqual([]);
  });
});

describe('basisLabel', () => {
  test('describes how much personal history backs a prediction', () => {
    expect(basisLabel(0)).toBe('Population default - no history yet');
    expect(basisLabel(1)).toBe('Based on 1 of your meetings + population default');
    expect(basisLabel(5)).toBe('Based on 5 of your meetings + population default');
    expect(basisLabel(6)).toBe('Based on 6 of your meetings');
  });
});
