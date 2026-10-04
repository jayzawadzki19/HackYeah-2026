import type { MeetingType, Rating, WorkoutIntensity } from '../../../contracts/api-contract';

/** Shape of `app/api/data/calendars/{userKey}.json` (mock calendar, the CalendarProvider seam). */
export interface CalendarFile {
  readonly userKey: 'jakub' | 'marta';
  readonly displayName: string;
  readonly isSynthetic: boolean;
  readonly timeZone: string;
  readonly people: readonly CalendarPerson[];
  readonly events: readonly CalendarFileEvent[];
  /** seeded reflections (persona history); reflections made in the app live in SQLite and win */
  readonly reflections: readonly { readonly meetingId: string; readonly rating: Rating }[];
}

export interface CalendarPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
}

export type CalendarFileEvent =
  | {
      readonly id: string;
      readonly kind: 'meeting';
      readonly title: string;
      readonly type: MeetingType;
      /** ISO 8601 with offset */
      readonly start: string;
      readonly end: string;
      readonly attendeeIds: readonly string[];
      /** group events (standup, team) feed type effects only, never person scores */
      readonly isGroup: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'workout';
      readonly title: string;
      readonly intensity: WorkoutIntensity;
      readonly start: string;
      readonly end: string;
    };
