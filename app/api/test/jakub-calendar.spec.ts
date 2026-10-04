import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarFileSchema } from '../src/calendar/calendar.schema';

describe('jakub.json', () => {
  const file = calendarFileSchema.parse(JSON.parse(readFileSync(join(import.meta.dir, '../data/calendars/jakub.json'), 'utf8')));

  test('is a live Warsaw calendar named Jakub', () => {
    expect(file).toMatchObject({ userKey: 'jakub', displayName: 'Jakub', isSynthetic: false, timeZone: 'Europe/Warsaw' });
  });

  test('holds a past pitch rehearsal, a jury pitch tomorrow afternoon, a team sync and a mentor', () => {
    const meetings = file.events.filter((event) => event.kind === 'meeting');
    const rehearsal = meetings.find((event) => event.kind === 'meeting' && event.title === 'Pitch rehearsal');
    const jury = meetings.find((event) => event.kind === 'meeting' && event.title === 'Jury pitch');
    const syncs = meetings.filter((event) => event.kind === 'meeting' && event.type === 'team_sync');
    const mentors = meetings.filter((event) => event.kind === 'meeting' && event.type === 'mentor');

    expect(rehearsal).toMatchObject({ type: 'pitch' });
    expect(jury).toMatchObject({ type: 'pitch', start: '2026-10-05T15:00:00+02:00' });
    expect(Date.parse(rehearsal?.kind === 'meeting' ? rehearsal.start : '')).toBeLessThan(Date.parse('2026-10-04T00:00:00+02:00'));
    expect(syncs.length).toBeGreaterThan(0);
    expect(mentors.length).toBeGreaterThan(0);
  });
});
