import { describe, expect, test } from 'bun:test';
import {
  addDays,
  isoWithOffset,
  localDateTime,
  localParts,
  startOfLocalDay,
  weekdayOf,
  zoneOffset,
} from './time';

const TZ = 'Europe/Warsaw';

describe('localDateTime', () => {
  test('converts a summer local time (CEST, +02:00)', () => {
    expect(localDateTime('2026-10-05', 10 * 60, TZ)).toBe(Date.parse('2026-10-05T08:00:00Z'));
  });

  test('converts a winter local time (CET, +01:00)', () => {
    expect(localDateTime('2026-11-03', 10 * 60, TZ)).toBe(Date.parse('2026-11-03T09:00:00Z'));
  });

  test('is DST-safe on the autumn transition day', () => {
    expect(localDateTime('2026-10-25', 0, TZ)).toBe(Date.parse('2026-10-24T22:00:00Z'));
    expect(localDateTime('2026-10-25', 12 * 60, TZ)).toBe(Date.parse('2026-10-25T11:00:00Z'));
  });
});

describe('localParts', () => {
  test('returns date, hour, minute, minute of day and weekday', () => {
    expect(localParts(Date.parse('2026-10-02T14:30:00Z'), TZ)).toEqual({
      date: '2026-10-02',
      hour: 16,
      minute: 30,
      minuteOfDay: 16 * 60 + 30,
      weekday: 5,
    });
  });

  test('crosses midnight in local time, not UTC', () => {
    expect(localParts(Date.parse('2026-10-03T22:10:00Z'), TZ).date).toBe('2026-10-04');
  });

  test('round-trips with localDateTime across a DST change', () => {
    const t = localDateTime('2026-10-26', 9 * 60 + 15, TZ);
    expect(localParts(t, TZ)).toMatchObject({ date: '2026-10-26', hour: 9, minute: 15 });
  });
});

describe('calendar date helpers', () => {
  test('addDays moves across month boundaries', () => {
    expect(addDays('2026-10-04', -42)).toBe('2026-08-23');
    expect(addDays('2026-10-04', 7)).toBe('2026-10-11');
  });

  test('weekdayOf uses 0 = Sunday', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-02')).toBe(5);
  });

  test('startOfLocalDay is local midnight', () => {
    expect(startOfLocalDay('2026-10-04', TZ)).toBe(Date.parse('2026-10-03T22:00:00Z'));
  });
});

describe('offset formatting', () => {
  test('zoneOffset gives the signed offset of the instant', () => {
    expect(zoneOffset(Date.parse('2026-10-05T08:00:00Z'), TZ)).toBe('+02:00');
    expect(zoneOffset(Date.parse('2026-11-03T09:00:00Z'), TZ)).toBe('+01:00');
  });

  test('isoWithOffset renders local wall time with the offset', () => {
    expect(isoWithOffset(Date.parse('2026-10-05T08:00:00Z'), TZ)).toBe('2026-10-05T10:00:00+02:00');
    expect(isoWithOffset(Date.parse('2026-11-03T09:00:00Z'), TZ)).toBe('2026-11-03T10:00:00+01:00');
  });
});
