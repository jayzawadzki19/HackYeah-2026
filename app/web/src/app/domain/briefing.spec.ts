import type { AcceptActionResultDto, ActionDto, BriefingDto, EnergyMapDto, EnergyMapEntryDto } from '@contracts';
import { applyAccepted, briefingFocus, checkInQuestion, mergeEnergyEntries } from './briefing';

const action = (id: string, accepted = false): ActionDto => ({
  id,
  rule: 'sleep_target',
  title: id,
  evidence: '',
  evidenceRefs: [],
  impact: 1,
  altersProjection: true,
  accepted,
});

const briefing = (gapLevel: 'red' | 'amber' | 'green' | null, heaviestInDays: number | null = null): BriefingDto => ({
  user: { key: 'marta', displayName: 'Marta', isSynthetic: true, live: false, timeZone: 'Europe/Warsaw' },
  computedAt: '2026-10-04T18:00:00+02:00',
  stale: false,
  headline: '',
  capacity: { score: 54, components: [] },
  tomorrow: { date: '2026-10-05', dayLoad: 83, meetings: [], workouts: [], heaviestInDays },
  outlook: { capacity: 54, dayLoad: 83, gap: 29, gapLevel },
  projected: null,
  actions: [action('A1'), action('A2')],
  upcoming: [],
  live: null,
});

describe('briefingFocus', () => {
  it('leads with tomorrow when tomorrow is over capacity', () => {
    expect(briefingFocus(briefing('red'))).toBe('tomorrow');
    expect(briefingFocus(briefing('amber'))).toBe('tomorrow');
  });

  it('leads with tomorrow when it is the heaviest day in weeks', () => {
    expect(briefingFocus(briefing('green', 42))).toBe('tomorrow');
  });

  it('leads with right now when tomorrow has headroom', () => {
    expect(briefingFocus(briefing('green'))).toBe('now');
    expect(briefingFocus(briefing(null))).toBe('now');
  });
});

describe('applyAccepted', () => {
  const result: AcceptActionResultDto = {
    actionId: 'A2',
    block: null,
    projected: { capacity: 54, dayLoad: 75, gap: 21, gapLevel: 'red' },
  };

  it('marks the action accepted and stores the new projection', () => {
    const next = applyAccepted(briefing('red'), result);

    expect(next.actions.map(a => a.accepted)).toEqual([false, true]);
    expect(next.projected).toEqual(result.projected);
  });

  it('does not touch other fields', () => {
    const before = briefing('red');
    const next = applyAccepted(before, result);

    expect(next.outlook).toBe(before.outlook);
    expect(next.capacity).toBe(before.capacity);
  });
});

describe('mergeEnergyEntries', () => {
  const entry = (id: string, felt: number): EnergyMapEntryDto => ({
    person: { id, name: id, role: null },
    meetings: 5,
    bodyEffect: 10,
    felt,
    reflections: 3,
    group: 'hidden_drain',
    confidence: 'medium',
    explanation: '',
  });
  const map: EnergyMapDto = { computedAt: '2026-10-04T18:00:00+02:00', people: [entry('anna', -0.6), entry('piotr', 0)], belowThresholdCount: 21 };

  it('replaces updated people in place', () => {
    const next = mergeEnergyEntries(map, [entry('piotr', 0.25)]);

    expect(next.people.map(p => [p.person.id, p.felt])).toEqual([
      ['anna', -0.6],
      ['piotr', 0.25],
    ]);
    expect(next.belowThresholdCount).toBe(21);
  });

  it('adds a person who just reached the threshold', () => {
    expect(mergeEnergyEntries(map, [entry('ola', 0.5)]).people.map(p => p.person.id)).toEqual(['anna', 'piotr', 'ola']);
  });
});

describe('checkInQuestion', () => {
  it('asks about the meeting by weekday and title', () => {
    expect(checkInQuestion({ title: '1:1 with Piotr', start: '2026-10-02T16:30:00+02:00' }, 'Europe/Warsaw')).toBe(
      'Friday 1:1 with Piotr - how did it feel?',
    );
  });
});
