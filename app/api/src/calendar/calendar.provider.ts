import type { ProblemDetailsDto, UserKey } from '../../../contracts/api-contract';
import type { ProblemSource } from '../common/problem';
import type { EngineEvent, EnginePerson, Reflection } from '../engine/types';

export interface CalendarProfile {
  readonly userKey: UserKey;
  readonly displayName: string;
  readonly isSynthetic: boolean;
  readonly timeZone: string;
}

/** The seam for production calendars (Google, Microsoft); the mock implementation reads JSON files. */
export interface CalendarProvider {
  profile(userKey: UserKey): Promise<CalendarProfile>;
  events(userKey: UserKey): Promise<readonly EngineEvent[]>;
  people(userKey: UserKey): Promise<readonly EnginePerson[]>;
  seedReflections(userKey: UserKey): Promise<readonly Reflection[]>;
}

export const CALENDAR_PROVIDER = Symbol('CalendarProvider');

export class CalendarUnavailableError extends Error implements ProblemSource {
  override readonly name = 'CalendarUnavailableError';

  constructor(
    readonly userKey: UserKey,
    readonly reason: string,
  ) {
    super(`Calendar for "${userKey}" is unavailable: ${reason}`);
  }

  toProblem(): ProblemDetailsDto {
    return { type: '/problems/calendar-unavailable', title: 'Calendar unavailable', status: 503, detail: this.message };
  }
}
