import type { AcceptActionResultDto, BriefingDto, EnergyMapDto, EnergyMapEntryDto } from '@contracts';
import { weekdayOf } from './time';

export type BriefingFocus = 'tomorrow' | 'now';

/** Tomorrow leads when it is heavy or the heaviest day in the window. Otherwise the live moment leads. */
export const briefingFocus = (briefing: BriefingDto): BriefingFocus => {
  const level = briefing.outlook.gapLevel;
  if (level === 'red' || level === 'amber') return 'tomorrow';
  if (briefing.tomorrow.heaviestInDays !== null) return 'tomorrow';
  return 'now';
};

export const applyAccepted = (briefing: BriefingDto, result: AcceptActionResultDto): BriefingDto => ({
  ...briefing,
  actions: briefing.actions.map(action => (action.id === result.actionId ? { ...action, accepted: true } : action)),
  projected: result.projected,
});

export const mergeEnergyEntries = (map: EnergyMapDto, updated: readonly EnergyMapEntryDto[]): EnergyMapDto => {
  const incoming = new Map(updated.map(entry => [entry.person.id, entry]));
  const seen = new Set(map.people.map(entry => entry.person.id));
  const people = map.people.map(entry => incoming.get(entry.person.id) ?? entry);
  for (const entry of updated) {
    if (!seen.has(entry.person.id)) people.push(entry);
  }
  return { ...map, people };
};

export const checkInQuestion = (meeting: { readonly title: string; readonly start: string }, timeZone: string): string =>
  `${weekdayOf(meeting.start, timeZone)} ${meeting.title} - how did it feel?`;
