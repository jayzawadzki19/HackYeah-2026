import { addDays, dayLabel, durationText, localDate, relativeAgo, shortDate, timeOf, weekdayOf } from './time';

const TZ = 'Europe/Warsaw';

describe('time helpers', () => {
  it('formats a local 24h time in the user time zone', () => {
    expect(timeOf('2026-10-05T08:00:00Z', TZ)).toBe('10:00');
    expect(timeOf('2026-10-04T20:45:00Z', TZ)).toBe('22:45');
  });

  it('names the local weekday', () => {
    expect(weekdayOf('2026-10-02T14:30:00Z', TZ)).toBe('Friday');
    expect(weekdayOf('2026-10-04T22:30:00Z', TZ)).toBe('Monday');
  });

  it('derives the local date, not the UTC one', () => {
    expect(localDate('2026-10-04T22:30:00Z', TZ)).toBe('2026-10-05');
  });

  it('formats a calendar date without shifting it', () => {
    expect(shortDate('2026-10-05')).toBe('Mon 5 Oct');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-04', -38)).toBe('2026-08-27');
  });

  it('labels today and tomorrow', () => {
    expect(dayLabel('2026-10-04', '2026-10-04')).toBe('Today');
    expect(dayLabel('2026-10-05', '2026-10-04')).toBe('Tomorrow');
    expect(dayLabel('2026-10-07', '2026-10-04')).toBe('Wed 7 Oct');
  });

  describe('relativeAgo', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');

    it.each([
      ['2026-10-04T11:59:40Z', 'just now'],
      ['2026-10-04T11:59:00Z', '1 min ago'],
      ['2026-10-04T11:46:00Z', '14 min ago'],
      ['2026-10-04T10:00:00Z', '2 h ago'],
      ['2026-10-02T12:00:00Z', '2 days ago'],
    ])('describes %s as "%s"', (iso, text) => {
      expect(relativeAgo(iso, now)).toBe(text);
    });

    it('treats a timestamp slightly in the future as just now', () => {
      expect(relativeAgo('2026-10-04T12:00:20Z', now)).toBe('just now');
    });

    it('says never without a timestamp', () => {
      expect(relativeAgo(null, now)).toBe('never');
    });
  });

  it.each([
    [10, '10 min'],
    [45, '45 min'],
    [60, '1 h'],
    [90, '1 h 30'],
    [120, '2 h'],
  ])('formats %d minutes as "%s"', (minutes, text) => {
    expect(durationText(minutes)).toBe(text);
  });
});
