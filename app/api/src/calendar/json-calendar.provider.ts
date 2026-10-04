import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UserKey } from '../../../contracts/api-contract';
import type { EngineEvent, EnginePerson, Reflection } from '../engine/types';
import type { CalendarFile, CalendarFileEvent } from './calendar-file';
import { type CalendarProfile, type CalendarProvider, CalendarUnavailableError } from './calendar.provider';
import { calendarFileSchema, formatIssues } from './calendar.schema';

interface LoadedCalendar {
  readonly profile: CalendarProfile;
  readonly events: readonly EngineEvent[];
  readonly people: readonly EnginePerson[];
  readonly reflections: readonly Reflection[];
}

export const toEngineEvent = (event: CalendarFileEvent): EngineEvent =>
  event.kind === 'meeting'
    ? {
        kind: 'meeting',
        id: event.id,
        title: event.title,
        type: event.type,
        start: Date.parse(event.start),
        end: Date.parse(event.end),
        attendeeIds: event.attendeeIds,
        isGroup: event.isGroup,
      }
    : {
        kind: 'workout',
        id: event.id,
        title: event.title,
        intensity: event.intensity,
        start: Date.parse(event.start),
        end: Date.parse(event.end),
        movedByHeadroom: false,
      };

const toLoaded = (file: CalendarFile): LoadedCalendar => ({
  profile: { userKey: file.userKey, displayName: file.displayName, isSynthetic: file.isSynthetic, timeZone: file.timeZone },
  events: file.events.map(toEngineEvent),
  people: file.people,
  reflections: file.reflections,
});

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reads `{dir}/{userKey}.json`, validates it, and caches it until the file's mtime changes. */
export class JsonCalendarProvider implements CalendarProvider {
  private readonly cache = new Map<UserKey, { readonly mtimeMs: number; readonly calendar: LoadedCalendar }>();

  constructor(private readonly dir: string) {}

  async profile(userKey: UserKey): Promise<CalendarProfile> {
    return (await this.load(userKey)).profile;
  }

  async events(userKey: UserKey): Promise<readonly EngineEvent[]> {
    return (await this.load(userKey)).events;
  }

  async people(userKey: UserKey): Promise<readonly EnginePerson[]> {
    return (await this.load(userKey)).people;
  }

  async seedReflections(userKey: UserKey): Promise<readonly Reflection[]> {
    return (await this.load(userKey)).reflections;
  }

  private async load(userKey: UserKey): Promise<LoadedCalendar> {
    const path = join(this.dir, `${userKey}.json`);
    const { mtimeMs } = await stat(path).catch((error: unknown) => {
      throw new CalendarUnavailableError(userKey, `cannot read ${userKey}.json (${describe(error)})`);
    });
    const cached = this.cache.get(userKey);
    if (cached?.mtimeMs === mtimeMs) return cached.calendar;
    const calendar = await this.parse(userKey, path);
    this.cache.set(userKey, { mtimeMs, calendar });
    return calendar;
  }

  private async parse(userKey: UserKey, path: string): Promise<LoadedCalendar> {
    const json = await readFile(path, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch((error: unknown) => {
        throw new CalendarUnavailableError(userKey, `${userKey}.json is not valid JSON (${describe(error)})`);
      });
    const result = calendarFileSchema.safeParse(json);
    if (!result.success) throw new CalendarUnavailableError(userKey, `${userKey}.json is invalid: ${formatIssues(result.error)}`);
    if (result.data.userKey !== userKey) {
      throw new CalendarUnavailableError(userKey, `${userKey}.json declares userKey "${result.data.userKey}"`);
    }
    return toLoaded(result.data);
  }
}
