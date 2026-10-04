import { describe, expect, test } from 'bun:test';
import { capitalize, firstName, formatClock, formatHoursMinutes, typeLabel, typePlural, weekdayName } from './format';

describe('formatClock', () => {
  test('formats an instant as local HH:mm', () => {
    expect(formatClock(Date.parse('2026-10-04T20:45:00Z'), 'Europe/Warsaw')).toBe('22:45');
    expect(formatClock(Date.parse('2026-10-05T07:45:00Z'), 'Europe/Warsaw')).toBe('09:45');
  });
});

describe('formatHoursMinutes', () => {
  test('formats fractional hours as XhMM', () => {
    expect(formatHoursMinutes(6 + 5 / 60)).toBe('6h05');
    expect(formatHoursMinutes(7.5)).toBe('7h30');
    expect(formatHoursMinutes(8)).toBe('8h00');
  });

  test('carries rounded minutes into the hour', () => {
    expect(formatHoursMinutes(6 + 59.7 / 60)).toBe('7h00');
  });
});

describe('weekdayName', () => {
  test('names the weekday of a local date', () => {
    expect(weekdayName('2026-10-05')).toBe('Monday');
    expect(weekdayName('2026-10-10')).toBe('Saturday');
  });
});

describe('meeting type wording', () => {
  test('typeLabel gives the singular display name', () => {
    expect(typeLabel('board')).toBe('Board');
    expect(typeLabel('one_on_one')).toBe('1:1');
    expect(typeLabel('product_review')).toBe('Product review');
  });

  test('typePlural gives the lower-case plural for mid-sentence use', () => {
    expect(typePlural('one_on_one')).toBe('1:1s');
    expect(typePlural('board')).toBe('board meetings');
  });

  test('capitalize upper-cases the first letter only', () => {
    expect(capitalize('board meetings')).toBe('Board meetings');
    expect(capitalize('1:1s')).toBe('1:1s');
  });
});

describe('firstName', () => {
  test('takes the first word of a full name', () => {
    expect(firstName('Piotr Nowak')).toBe('Piotr');
    expect(firstName('  Ola  Wiśniewska ')).toBe('Ola');
  });
});
