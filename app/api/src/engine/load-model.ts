import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { solveLinearSystem } from './linear';
import { clamp, mean, round0, sampleSd } from './math';
import { modifierOffset, type MeetingModifiers } from './meeting-load';
import type { EngineMeeting, MeetingType } from './types';

export interface LoadObservation {
  readonly meeting: EngineMeeting;
  /** measured load */
  readonly load: number;
  readonly modifiers: MeetingModifiers;
}

export interface LoadModel {
  readonly typeEffects: Readonly<Record<MeetingType, number>>;
  readonly personEffects: ReadonlyMap<string, number>;
  readonly typeCounts: Readonly<Record<MeetingType, number>>;
  readonly personCounts: ReadonlyMap<string, number>;
  /** sample sd of the fit residuals over a person's meetings; only for people with 2+ meetings */
  readonly personResidualSd: ReadonlyMap<string, number>;
}

export interface LoadBasis {
  readonly typeMeetings: number;
  readonly personMeetings: readonly { readonly personId: string; readonly meetings: number }[];
}

export interface MeetingPrediction {
  readonly load: number;
  readonly basis: LoadBasis;
  readonly label: string;
}

/** Below this many meetings of a type the label admits the population default still contributes. */
const OWN_HISTORY_MEETINGS = 6;

/** People whose effect is modelled for a meeting: none for group events, otherwise the distinct attendees. */
export const scoredAttendees = (meeting: Pick<EngineMeeting, 'attendeeIds' | 'isGroup'>): readonly string[] =>
  meeting.isGroup ? [] : [...new Set(meeting.attendeeIds)];

const meetingTypes = (cfg: EngineConfig): readonly MeetingType[] => Object.keys(cfg.TYPE_PRIORS) as MeetingType[];

/**
 * Architecture 7.4: load = typeEffect + mean(personEffect over attendees) + modifiers.
 * Ridge regression toward TYPE_PRIORS (types) and 0 (people) with prior strength
 * SHRINKAGE_PSEUDO_MEETINGS, solved through the normal equations
 * (X'X + lambda I) theta = X'y + lambda mu. Modifiers are known offsets subtracted from y.
 */
export const fitLoadModel = (observations: readonly LoadObservation[], cfg: EngineConfig = ENGINE_CONFIG): LoadModel => {
  const types = meetingTypes(cfg);
  const people = [...new Set(observations.flatMap((o) => scoredAttendees(o.meeting)))].sort();
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  const personIndex = new Map(people.map((p, i) => [p, types.length + i]));
  const lambda = cfg.SHRINKAGE_PSEUDO_MEETINGS;

  const rows = observations.map((o) => {
    const attendees = scoredAttendees(o.meeting);
    const entries: readonly (readonly [number, number])[] = [
      [typeIndex.get(o.meeting.type)!, 1],
      ...attendees.map((p): readonly [number, number] => [personIndex.get(p)!, 1 / attendees.length]),
    ];
    return { entries, attendees, y: o.load - modifierOffset(o.modifiers, cfg) };
  });

  const priors = [...types.map((t) => cfg.TYPE_PRIORS[t]), ...people.map(() => 0)];
  const a = priors.map((_, i) => priors.map((__, j) => (i === j ? lambda : 0)));
  const b = priors.map((mu) => lambda * mu);
  rows.forEach(({ entries, y }) =>
    entries.forEach(([i, wi]) => {
      b[i]! += wi * y;
      entries.forEach(([j, wj]) => {
        a[i]![j]! += wi * wj;
      });
    }),
  );
  const theta = solveLinearSystem(a, b);

  const residualsByPerson = rows.reduce((acc, { entries, attendees, y }) => {
    const residual = y - entries.reduce((sumAcc, [i, w]) => sumAcc + w * theta[i]!, 0);
    attendees.forEach((p) => acc.set(p, [...(acc.get(p) ?? []), residual]));
    return acc;
  }, new Map<string, number[]>());

  return {
    typeEffects: Object.fromEntries(types.map((t, i) => [t, theta[i]!])) as Record<MeetingType, number>,
    personEffects: new Map(people.map((p) => [p, theta[personIndex.get(p)!]!])),
    typeCounts: Object.fromEntries(
      types.map((t) => [t, observations.filter((o) => o.meeting.type === t).length]),
    ) as Record<MeetingType, number>,
    personCounts: new Map([...residualsByPerson].map(([p, residuals]) => [p, residuals.length])),
    personResidualSd: new Map(
      [...residualsByPerson].flatMap(([p, residuals]) => {
        const sd = sampleSd(residuals);
        return sd === null ? [] : [[p, sd] as const];
      }),
    ),
  };
};

export const basisLabel = (typeMeetings: number): string =>
  typeMeetings === 0
    ? 'Population default - no history yet'
    : typeMeetings < OWN_HISTORY_MEETINGS
      ? `Based on ${typeMeetings} of your meetings + population default`
      : `Based on ${typeMeetings} of your meetings`;

export const predictMeetingLoad = (
  model: LoadModel,
  meeting: Pick<EngineMeeting, 'type' | 'attendeeIds' | 'isGroup'>,
  modifiers: MeetingModifiers,
  cfg: EngineConfig = ENGINE_CONFIG,
): MeetingPrediction => {
  const attendees = scoredAttendees(meeting);
  const personTerm = mean(attendees.map((p) => model.personEffects.get(p) ?? 0)) ?? 0;
  const typeMeetings = model.typeCounts[meeting.type];
  return {
    load: round0(clamp(model.typeEffects[meeting.type] + personTerm + modifierOffset(modifiers, cfg), 0, 100)),
    basis: {
      typeMeetings,
      personMeetings: attendees.map((personId) => ({ personId, meetings: model.personCounts.get(personId) ?? 0 })),
    },
    label: basisLabel(typeMeetings),
  };
};
