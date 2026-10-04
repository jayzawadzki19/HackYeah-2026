import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { firstName, typeLabel } from './format';
import { scoredAttendees, type LoadModel } from './load-model';
import { groupBy, mean, round0, round1 } from './math';
import type { EnergyGroup, EngineMeeting, EnginePerson, MeetingType, Reflection } from './types';

export interface EnergyEntry {
  readonly person: EnginePerson;
  /** past non-group meetings attended */
  readonly meetings: number;
  /** fitted person effect in load points (+ drains, - energizes) */
  readonly bodyEffect: number;
  /** mean reflection -1..1, null without reflections */
  readonly felt: number | null;
  readonly reflections: number;
  readonly group: EnergyGroup;
  readonly confidence: 'high' | 'medium';
  readonly explanation: string;
}

export interface EnergyMap {
  readonly entries: readonly EnergyEntry[];
  /** people with 1 to MIN_MEETINGS_PER_PERSON - 1 past meetings: not scored */
  readonly belowThresholdCount: number;
}

const DRAIN_EFFECT = 4;
const DRAINED_FELT = -0.25;
const ENERGIZER_EFFECT = -3;
const ENERGIZED_FELT = 0.25;
const HIGH_CONFIDENCE_MEETINGS = 6;
const HIGH_CONFIDENCE_MAX_RESIDUAL_SD = 10;
const DEMANDING_TYPE_EFFECT = 60;

/** Architecture 7.7. Without reflections `felt` is unknown and treated as neutral (0) for grouping. */
export const energyGroup = (bodyEffect: number, felt: number | null): EnergyGroup => {
  const f = felt ?? 0;
  if (bodyEffect >= DRAIN_EFFECT) return f <= DRAINED_FELT ? 'known_drain' : 'hidden_drain';
  if (f <= DRAINED_FELT) return 'overestimated';
  if (bodyEffect <= ENERGIZER_EFFECT || f >= ENERGIZED_FELT) return 'energizer';
  return 'neutral';
};

const roundFelt = (value: number): number => Math.round(value * 100) / 100;

const mostFrequentType = (meetings: readonly EngineMeeting[], model: LoadModel): MeetingType =>
  [...groupBy(meetings, (m) => m.type)]
    .map(([type, list]) => ({ type, count: list.length, effect: model.typeEffects[type] }))
    .sort((a, b) => b.count - a.count || b.effect - a.effect || a.type.localeCompare(b.type))[0]!.type;

const explain = (group: EnergyGroup, effect: number, name: string, demandingType: MeetingType | null): string => {
  switch (group) {
    case 'known_drain':
      return `Meetings with ${name} cost you about +${round0(effect)} points, and you feel it too.`;
    case 'hidden_drain':
      return `Meetings with ${name} cost you about +${round0(effect)} points more than they feel.`;
    case 'energizer':
      return round0(-effect) > 0
        ? `Meetings with ${name} lower your stress load (about ${round0(-effect)} points).`
        : `Meetings with ${name} feel energizing and cost you almost nothing.`;
    case 'overestimated':
      return `Meetings with ${name} feel draining, but your body stays calm.`;
    case 'neutral':
      return demandingType
        ? `${typeLabel(demandingType)} meetings are demanding for you; ${name} is not the reason.`
        : `Meetings with ${name} have no measurable effect either way.`;
  }
};

/** Private energy map over past meetings: who drains or energizes you, measured vs felt. */
export const energyMap = (
  model: LoadModel,
  meetings: readonly EngineMeeting[],
  reflections: readonly Reflection[],
  people: readonly EnginePerson[],
  cfg: EngineConfig = ENGINE_CONFIG,
): EnergyMap => {
  const personById = new Map(people.map((p) => [p.id, p]));
  const ratingByMeeting = new Map(reflections.map((r) => [r.meetingId, r.rating]));
  const byPerson = groupBy(
    meetings.flatMap((m) => scoredAttendees(m).map((personId) => ({ personId, meeting: m }))),
    (pair) => pair.personId,
  );
  const tallies = [...byPerson].map(([personId, pairs]) => ({ personId, meetings: pairs.map((p) => p.meeting) }));
  const scored = tallies.filter((t) => t.meetings.length >= cfg.MIN_MEETINGS_PER_PERSON);

  const entries = scored.map(({ personId, meetings: attended }): EnergyEntry => {
    const person = personById.get(personId) ?? { id: personId, name: personId, role: null };
    const bodyEffect = round1(model.personEffects.get(personId) ?? 0);
    const ratings = attended.flatMap((m) => {
      const rating = ratingByMeeting.get(m.id);
      return rating === undefined ? [] : [rating];
    });
    const feltMean = mean(ratings);
    const felt = feltMean === null ? null : roundFelt(feltMean);
    const group = energyGroup(bodyEffect, felt);
    const commonType = mostFrequentType(attended, model);
    const residualSd = model.personResidualSd.get(personId);
    return {
      person,
      meetings: attended.length,
      bodyEffect,
      felt,
      reflections: ratings.length,
      group,
      confidence:
        attended.length >= HIGH_CONFIDENCE_MEETINGS && residualSd !== undefined && residualSd <= HIGH_CONFIDENCE_MAX_RESIDUAL_SD
          ? 'high'
          : 'medium',
      explanation: explain(
        group,
        bodyEffect,
        firstName(person.name),
        model.typeEffects[commonType] >= DEMANDING_TYPE_EFFECT ? commonType : null,
      ),
    };
  });

  return {
    entries: [...entries].sort((a, b) => b.bodyEffect - a.bodyEffect || a.person.name.localeCompare(b.person.name)),
    belowThresholdCount: tallies.length - scored.length,
  };
};
