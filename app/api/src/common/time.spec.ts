import { describe, expect, test } from 'bun:test';
import { isoInZone, localClock, localDate } from './time';

const TZ = 'Europe/Warsaw';

describe('isoInZone', () => {
  test('formats summer time with a +02:00 offset', () => {
    expect(isoInZone(Date.parse('2026-10-05T08:00:00Z'), TZ)).toBe('2026-10-05T10:00:00+02:00');
  });

  test('formats winter time with a +01:00 offset after the October switch', () => {
    expect(isoInZone(Date.parse('2026-10-26T08:00:00Z'), TZ)).toBe('2026-10-26T09:00:00+01:00');
  });

  test('round-trips through Date.parse', () => {
    const t = Date.parse('2026-10-25T00:30:00Z');

    expect(Date.parse(isoInZone(t, TZ))).toBe(t);
  });

  test('handles UTC', () => {
    expect(isoInZone(Date.parse('2026-10-05T08:00:00Z'), 'UTC')).toBe('2026-10-05T08:00:00+00:00');
  });
});

describe('local formatting', () => {
  test('gives the local calendar date', () => {
    expect(localDate(Date.parse('2026-10-04T22:30:00Z'), TZ)).toBe('2026-10-05');
  });

  test('gives the local clock time as HH:mm', () => {
    expect(localClock(Date.parse('2026-10-04T20:45:00Z'), TZ)).toBe('22:45');
  });
});
