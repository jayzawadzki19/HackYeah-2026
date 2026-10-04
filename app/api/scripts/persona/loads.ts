import type { EpochMs } from '../../src/engine/types';
import { MEETING_TYPES, MODIFIERS, personById, type PersonaMeetingType } from './persona.truth';
import { localParts, MINUTE_MS } from './time';

export interface TimedMeeting {
  readonly type: PersonaMeetingType;
  readonly attendeeIds: readonly string[];
  readonly isGroup: boolean;
  readonly start: EpochMs;
  readonly end: EpochMs;
}

export interface Modifiers {
  readonly backToBack: boolean;
  readonly lateStart: boolean;
}

export const meetingModifiers = (
  meeting: TimedMeeting,
  sameDayMeetings: readonly TimedMeeting[],
  timeZone: string,
): Modifiers => ({
  backToBack: sameDayMeetings.some(
    (other) =>
      other !== meeting &&
      other.end <= meeting.start &&
      meeting.start - other.end <= MODIFIERS.backToBackGapMin * MINUTE_MS,
  ),
  lateStart: localParts(meeting.start, timeZone).hour >= MODIFIERS.lateStartHour,
});

const meanAttendeeEffect = (meeting: TimedMeeting): number =>
  meeting.isGroup || meeting.attendeeIds.length === 0
    ? 0
    : meeting.attendeeIds.reduce((sum, id) => sum + (personById(id)?.trueEffect ?? 0), 0) / meeting.attendeeIds.length;

/** The injected load before noise: type load + mean(attendee effects) + modifiers. */
export const expectedLoad = (meeting: TimedMeeting, modifiers: Modifiers): number =>
  MEETING_TYPES[meeting.type].trueLoad +
  meanAttendeeEffect(meeting) +
  (modifiers.backToBack ? MODIFIERS.backToBack : 0) +
  (modifiers.lateStart ? MODIFIERS.lateStart : 0);
