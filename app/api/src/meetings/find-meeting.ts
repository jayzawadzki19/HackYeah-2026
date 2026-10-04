import type { EngineEvent, EngineMeeting } from '../engine/types';

export const findMeeting = (events: readonly EngineEvent[], meetingId: string): EngineMeeting | null => {
  const event = events.find((candidate) => candidate.id === meetingId);
  return event?.kind === 'meeting' ? event : null;
};
