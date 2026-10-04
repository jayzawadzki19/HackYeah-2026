import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calendarFixture } from '../../test/support/calendar-fixture';
import type { CalendarFile } from './calendar-file';
import { CalendarUnavailableError } from './calendar.provider';
import { JsonCalendarProvider } from './json-calendar.provider';

const dirs: string[] = [];

const calendarDir = (files: Partial<Record<'jakub' | 'marta', CalendarFile | string>>) => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-calendar-'));
  dirs.push(dir);
  Object.entries(files).forEach(([key, content]) =>
    writeFileSync(join(dir, `${key}.json`), typeof content === 'string' ? content : JSON.stringify(content)),
  );
  return dir;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('JsonCalendarProvider', () => {
  test('loads the profile, people and seeded reflections', async () => {
    const provider = new JsonCalendarProvider(calendarDir({ jakub: calendarFixture() }));

    expect(await provider.profile('jakub')).toEqual({
      userKey: 'jakub',
      displayName: 'Jakub',
      isSynthetic: false,
      timeZone: 'Europe/Warsaw',
    });
    expect(await provider.people('jakub')).toEqual(calendarFixture().people);
    expect(await provider.seedReflections('jakub')).toEqual([{ meetingId: 'm-rehearsal', rating: -1 }]);
  });

  test('converts events to engine events with epoch-millisecond times', async () => {
    const provider = new JsonCalendarProvider(calendarDir({ jakub: calendarFixture() }));

    const events = await provider.events('jakub');

    expect(events[0]).toEqual({
      kind: 'meeting',
      id: 'm-rehearsal',
      title: 'Pitch rehearsal',
      type: 'pitch',
      start: Date.parse('2026-10-03T16:00:00Z'),
      end: Date.parse('2026-10-03T16:30:00Z'),
      attendeeIds: ['p-mentor'],
      isGroup: false,
    });
    expect(events[2]).toEqual({
      kind: 'workout',
      id: 'w-run',
      title: 'Easy run',
      intensity: 'easy',
      start: Date.parse('2026-10-05T05:00:00Z'),
      end: Date.parse('2026-10-05T05:40:00Z'),
      movedByHeadroom: false,
    });
  });

  test('rejects an event whose attendee is not in people, naming the field', async () => {
    const broken = calendarFixture();
    const [first, ...rest] = broken.events;
    const file = { ...broken, events: [{ ...first, attendeeIds: ['p-ghost'] }, ...rest] } as CalendarFile;
    const provider = new JsonCalendarProvider(calendarDir({ jakub: file }));

    const error = await provider.events('jakub').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CalendarUnavailableError);
    expect(String(error)).toContain('events.0.attendeeIds.0');
    expect(String(error)).toContain('p-ghost');
  });

  test('rejects events that end before they start', async () => {
    const broken = calendarFixture();
    const [first, ...rest] = broken.events;
    const file = { ...broken, events: [{ ...first, end: '2026-10-03T17:00:00+02:00' }, ...rest] } as CalendarFile;
    const provider = new JsonCalendarProvider(calendarDir({ jakub: file }));

    await expect(provider.events('jakub')).rejects.toThrow(/events\.0\.end/);
  });

  test('rejects a file stored under another user key', async () => {
    const provider = new JsonCalendarProvider(calendarDir({ marta: calendarFixture() }));

    await expect(provider.profile('marta')).rejects.toThrow(/userKey/);
  });

  test('reports a missing file as unavailable', async () => {
    const provider = new JsonCalendarProvider(calendarDir({}));

    await expect(provider.profile('marta')).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  test('reports invalid JSON as unavailable', async () => {
    const provider = new JsonCalendarProvider(calendarDir({ jakub: '{ not json' }));

    await expect(provider.profile('jakub')).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  test('serves the cached calendar while the file mtime is unchanged', async () => {
    const dir = calendarDir({ jakub: calendarFixture() });
    const path = join(dir, 'jakub.json');
    const pinned = new Date('2026-10-01T10:00:00Z');
    utimesSync(path, pinned, pinned);
    const provider = new JsonCalendarProvider(dir);
    await provider.profile('jakub');

    writeFileSync(path, JSON.stringify(calendarFixture({ displayName: 'Changed' })));
    utimesSync(path, pinned, pinned);

    expect((await provider.profile('jakub')).displayName).toBe('Jakub');
  });

  test('reloads the calendar when the file mtime changes', async () => {
    const dir = calendarDir({ jakub: calendarFixture() });
    const path = join(dir, 'jakub.json');
    const provider = new JsonCalendarProvider(dir);
    await provider.profile('jakub');

    writeFileSync(path, JSON.stringify(calendarFixture({ displayName: 'Changed' })));
    const later = new Date(statSync(path).mtimeMs + 5_000);
    utimesSync(path, later, later);

    expect((await provider.profile('jakub')).displayName).toBe('Changed');
  });
});
