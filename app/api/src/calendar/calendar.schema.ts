import { z } from 'zod';
import type { MeetingType, WorkoutIntensity } from '../../../contracts/api-contract';
import type { CalendarFile } from './calendar-file';

/** Lists every member of a string union; compilation fails if one is missing. */
const allOf =
  <T extends string>() =>
  <const V extends readonly T[]>(...values: V & ([T] extends [V[number]] ? unknown : never)) =>
    values;

export const MEETING_TYPES = allOf<MeetingType>()(
  'board',
  'pitch',
  'investor',
  'customer',
  'interview',
  'product_review',
  'one_on_one',
  'mentor',
  'team_sync',
  'standup',
);

export const WORKOUT_INTENSITIES = allOf<WorkoutIntensity>()('easy', 'tempo', 'intervals', 'long');

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const id = z.string().min(1);
const instant = z.iso.datetime({ offset: true });

const isOrdered = (event: { readonly start: string; readonly end: string }) => Date.parse(event.end) > Date.parse(event.start);
const endAfterStart = { message: 'must be after start', path: ['end'] };

const meeting = z
  .object({
    id,
    kind: z.literal('meeting'),
    title: z.string().min(1),
    type: z.enum(MEETING_TYPES),
    start: instant,
    end: instant,
    attendeeIds: z.array(id),
    isGroup: z.boolean(),
  })
  .refine(isOrdered, endAfterStart);

const workout = z
  .object({
    id,
    kind: z.literal('workout'),
    title: z.string().min(1),
    intensity: z.enum(WORKOUT_INTENSITIES),
    start: instant,
    end: instant,
  })
  .refine(isOrdered, endAfterStart);

const duplicates = (values: readonly string[]): readonly string[] =>
  values.filter((value, index) => values.indexOf(value) !== index);

export const calendarFileSchema = z
  .object({
    userKey: z.enum(['jakub', 'marta']),
    displayName: z.string().min(1),
    isSynthetic: z.boolean(),
    timeZone: z.string().refine(isTimeZone, 'must be an IANA time zone'),
    people: z.array(z.object({ id, name: z.string().min(1), role: z.string().nullable() })),
    events: z.array(z.discriminatedUnion('kind', [meeting, workout])),
    reflections: z.array(z.object({ meetingId: id, rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })),
  })
  .superRefine((file, ctx) => {
    const personIds = new Set(file.people.map((person) => person.id));
    const meetingIds = new Set(file.events.filter((event) => event.kind === 'meeting').map((event) => event.id));
    duplicates(file.events.map((event) => event.id)).forEach((dup) =>
      ctx.addIssue({ code: 'custom', path: ['events'], message: `duplicate event id "${dup}"` }),
    );
    duplicates(file.people.map((person) => person.id)).forEach((dup) =>
      ctx.addIssue({ code: 'custom', path: ['people'], message: `duplicate person id "${dup}"` }),
    );
    file.events.forEach((event, eventIndex) => {
      if (event.kind !== 'meeting') return;
      event.attendeeIds
        .map((attendeeId, attendeeIndex) => ({ attendeeId, attendeeIndex }))
        .filter(({ attendeeId }) => !personIds.has(attendeeId))
        .forEach(({ attendeeId, attendeeIndex }) =>
          ctx.addIssue({
            code: 'custom',
            path: ['events', eventIndex, 'attendeeIds', attendeeIndex],
            message: `unknown person "${attendeeId}"`,
          }),
        );
    });
    file.reflections.forEach((reflection, index) => {
      if (meetingIds.has(reflection.meetingId)) return;
      ctx.addIssue({
        code: 'custom',
        path: ['reflections', index, 'meetingId'],
        message: `unknown meeting "${reflection.meetingId}"`,
      });
    });
  }) satisfies z.ZodType<CalendarFile>;

export const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
