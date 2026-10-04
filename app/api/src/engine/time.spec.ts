import { describe, expect, test } from 'bun:test';
import { addLocalDays, localDate, localDateTime, localHour, localParts, startOfLocalDay, weekdayOf } from './time';

const WARSAW = 'Europe/Warsaw';
const utc = (iso: string): number => Date.parse(iso);

describe('localParts', () => {
  test('converts an instant to Warsaw wall-clock parts (summer time, +02:00)', () => {
    expect(localParts(utc('2026-10-04T09:00:00Z'), WARSAW)).toEqual({
      date: '2026-10-04',
      hour: 11,
      minute: 0,
      weekday: 0,
    });
  });

  test('rolls over to the next local date after local midnight', () => {
    expect(localParts(utc('2026-10-04T22:30:00Z'), WARSAW)).toEqual({
      date: '2026-10-05',
      hour: 0,
      minute: 30,
      weekday: 1,
    });
  });

  test('keeps minutes exact for half-hour offset zones', () => {
    expect(localParts(utc('2026-10-04T00:00:00Z'), 'Asia/Kolkata')).toMatchObject({ hour: 5, minute: 30 });
  });

  test('handles the late-October DST fall-back: 02:30 happens twice, 03:00 once', () => {
    expect(localParts(utc('2026-10-25T00:30:00Z'), WARSAW)).toMatchObject({ date: '2026-10-25', hour: 2, minute: 30 });
    expect(localParts(utc('2026-10-25T01:30:00Z'), WARSAW)).toMatchObject({ date: '2026-10-25', hour: 2, minute: 30 });
    expect(localParts(utc('2026-10-25T02:00:00Z'), WARSAW)).toMatchObject({ date: '2026-10-25', hour: 3, minute: 0 });
  });

  test('localHour and localDate agree with localParts across the DST boundary', () => {
    const instants = Array.from({ length: 30 }, (_, i) => utc('2026-10-24T20:00:00Z') + i * 20 * 60_000);
    instants.forEach((t) => {
      const parts = localParts(t, WARSAW);
      expect(localHour(t, WARSAW)).toBe(parts.hour);
      expect(localDate(t, WARSAW)).toBe(parts.date);
    });
  });
});

describe('startOfLocalDay', () => {
  test('returns local midnight as epoch ms', () => {
    expect(startOfLocalDay('2026-10-05', WARSAW)).toBe(utc('2026-10-04T22:00:00Z'));
  });

  test('the DST fall-back day is 25 hours long', () => {
    const length = startOfLocalDay('2026-10-26', WARSAW) - startOfLocalDay('2026-10-25', WARSAW);
    expect(length).toBe(25 * 3_600_000);
  });
});

describe('localDateTime', () => {
  test('converts a local wall-clock time to epoch ms', () => {
    expect(localDateTime('2026-10-05', '10:00', WARSAW)).toBe(utc('2026-10-05T08:00:00Z'));
    expect(localDateTime('2026-11-02', '10:00', WARSAW)).toBe(utc('2026-11-02T09:00:00Z'));
  });

  test('picks the earlier instant for an ambiguous fall-back time', () => {
    expect(localDateTime('2026-10-25', '02:30', WARSAW)).toBe(utc('2026-10-25T00:30:00Z'));
  });

  test('shifts a non-existent spring-forward time forward by the gap', () => {
    expect(localDateTime('2026-03-29', '02:30', WARSAW)).toBe(utc('2026-03-29T01:30:00Z'));
  });

  test('round-trips with localParts', () => {
    const t = localDateTime('2026-10-25', '22:45', WARSAW);
    expect(localParts(t, WARSAW)).toMatchObject({ date: '2026-10-25', hour: 22, minute: 45 });
  });

  test('rejects malformed input as a programmer error', () => {
    expect(() => localDateTime('2026-13-01', '10:00', WARSAW)).toThrow();
    expect(() => localDateTime('2026-10-05', '25:00', WARSAW)).toThrow();
  });
});

describe('calendar date helpers', () => {
  test('addLocalDays crosses month and year boundaries', () => {
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-10-04', -42)).toBe('2026-08-23');
  });

  test('weekdayOf returns 0 for Sunday through 6 for Saturday', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-10')).toBe(6);
  });
});
