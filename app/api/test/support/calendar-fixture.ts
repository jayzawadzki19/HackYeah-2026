import type { CalendarFile } from '../../src/calendar/calendar-file';

/** A small, valid calendar for a live user; tests override fields as needed. */
export const calendarFixture = (overrides: Partial<CalendarFile> = {}): CalendarFile => ({
  userKey: 'jakub',
  displayName: 'Jakub',
  isSynthetic: false,
  timeZone: 'Europe/Warsaw',
  people: [
    { id: 'p-mentor', name: 'Ewa Mazur', role: 'Mentor' },
    { id: 'p-team', name: 'Team', role: null },
  ],
  events: [
    {
      id: 'm-rehearsal',
      kind: 'meeting',
      title: 'Pitch rehearsal',
      type: 'pitch',
      start: '2026-10-03T18:00:00+02:00',
      end: '2026-10-03T18:30:00+02:00',
      attendeeIds: ['p-mentor'],
      isGroup: false,
    },
    {
      id: 'm-jury',
      kind: 'meeting',
      title: 'Jury pitch',
      type: 'pitch',
      start: '2026-10-04T13:00:00+02:00',
      end: '2026-10-04T13:10:00+02:00',
      attendeeIds: [],
      isGroup: false,
    },
    {
      id: 'w-run',
      kind: 'workout',
      title: 'Easy run',
      intensity: 'easy',
      start: '2026-10-05T07:00:00+02:00',
      end: '2026-10-05T07:40:00+02:00',
    },
  ],
  reflections: [{ meetingId: 'm-rehearsal', rating: -1 }],
  ...overrides,
});
