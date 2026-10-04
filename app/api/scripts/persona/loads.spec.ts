import { describe, expect, test } from 'bun:test';
import { expectedLoad, meetingModifiers, type TimedMeeting } from './loads';
import { localDateTime } from './time';

const TZ = 'Europe/Warsaw';
const at = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return localDateTime('2026-10-05', (h ?? 0) * 60 + (m ?? 0), TZ);
};
const meeting = (
  type: TimedMeeting['type'],
  start: string,
  end: string,
  attendeeIds: readonly string[] = [],
): TimedMeeting => ({ type, attendeeIds, isGroup: type === 'standup', start: at(start), end: at(end) });

describe('meetingModifiers', () => {
  const day = [
    meeting('standup', '09:00', '09:15'),
    meeting('board', '10:00', '12:00'),
    meeting('one_on_one', '12:00', '12:30', ['piotr-nowak']),
    meeting('investor', '14:00', '15:00'),
    meeting('customer', '16:30', '17:00'),
  ];
  const modifiersOf = (index: number) => meetingModifiers(day[index] as TimedMeeting, day, TZ);

  test('flags a meeting that starts within 5 minutes of the previous one ending', () => {
    expect(modifiersOf(2)).toEqual({ backToBack: true, lateStart: false });
  });

  test('a 45-minute gap is not back-to-back', () => {
    expect(modifiersOf(1)).toEqual({ backToBack: false, lateStart: false });
  });

  test('flags starts at or after 16:00 local time', () => {
    expect(modifiersOf(4)).toEqual({ backToBack: false, lateStart: true });
  });

  test('a 5-minute gap still counts, a 6-minute gap does not', () => {
    const first = meeting('interview', '10:00', '11:00');
    expect(meetingModifiers(meeting('customer', '11:05', '11:30'), [first], TZ).backToBack).toBe(true);
    expect(meetingModifiers(meeting('customer', '11:06', '11:30'), [first], TZ).backToBack).toBe(false);
  });
});

describe('expectedLoad (noise-free true load)', () => {
  test('type load + mean attendee effect: board with Anna, Kasia, Piotr is 80 + 11', () => {
    const board = meeting('board', '10:00', '12:00', ['anna-kowalska', 'kasia-wojcik', 'piotr-nowak']);
    expect(expectedLoad(board, { backToBack: false, lateStart: false })).toBe(91);
  });

  test('adds +8 back-to-back and +5 late start', () => {
    const oneOnOne = meeting('one_on_one', '16:30', '17:00', ['piotr-nowak']);
    expect(expectedLoad(oneOnOne, { backToBack: true, lateStart: true })).toBe(35 + 15 + 8 + 5);
  });

  test('group events and unknown attendees add nothing', () => {
    expect(expectedLoad(meeting('standup', '09:00', '09:15'), { backToBack: false, lateStart: false })).toBe(15);
  });

  test('a new person (future-only) counts as effect 0 in the mean', () => {
    const investor = meeting('investor', '14:00', '15:00', ['anna-kowalska', 'michal-zielinski']);
    expect(expectedLoad(investor, { backToBack: false, lateStart: false })).toBe(72 + 9);
  });
});
