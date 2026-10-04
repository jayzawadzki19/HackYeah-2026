import type { BlockDto, PredictedMeetingDto, WeekDayDto, WorkoutDto } from '@contracts';
import { dayTimeline } from './timeline';

const TZ = 'Europe/Warsaw';

const meeting = (id: string, start: string, end: string): PredictedMeetingDto => ({
  id,
  title: id,
  type: 'board',
  start,
  end,
  attendees: [],
  isGroup: false,
  predictedLoad: 50,
  basis: { typeMeetings: 1, personMeetings: [], label: '' },
  modifiers: { backToBack: false, lateStart: false },
});

const block = (id: string, start: string, end: string): BlockDto => ({ id, actionId: id, title: id, start, end, forDate: '2026-10-05' });

const run: WorkoutDto = {
  id: 'run',
  title: 'Run',
  intensity: 'intervals',
  start: '2026-10-05T18:30:00+02:00',
  end: '2026-10-05T19:30:00+02:00',
  load: 8,
  movedByHeadroom: false,
};

const day: WeekDayDto = {
  date: '2026-10-05',
  dayLoad: 83,
  capacityForecast: 54,
  meetings: [meeting('board', '2026-10-05T10:00:00+02:00', '2026-10-05T12:00:00+02:00'), meeting('standup', '2026-10-05T09:00:00+02:00', '2026-10-05T09:15:00+02:00')],
  workouts: [run],
  blocks: [
    block('walk', '2026-10-05T09:45:00+02:00', '2026-10-05T09:55:00+02:00'),
    block('lights-out', '2026-10-04T22:45:00+02:00', '2026-10-05T06:30:00+02:00'),
  ],
};

describe('dayTimeline', () => {
  it('orders meetings, workouts and Headroom blocks by start time', () => {
    expect(dayTimeline(day, TZ).items.map(i => i.id)).toEqual(['standup', 'walk', 'board', 'run']);
  });

  it('moves blocks that start the evening before into their own group', () => {
    const timeline = dayTimeline(day, TZ);

    expect(timeline.eveningBefore.map(i => i.id)).toEqual(['lights-out']);
    expect(timeline.items.some(i => i.id === 'lights-out')).toBe(false);
  });

  it('tags every item with its kind and duration', () => {
    const [standup, walk] = dayTimeline(day, TZ).items;

    expect(standup).toMatchObject({ kind: 'meeting', minutes: 15 });
    expect(walk).toMatchObject({ kind: 'block', minutes: 10 });
  });

  it('is empty for a free day', () => {
    expect(dayTimeline({ ...day, meetings: [], workouts: [], blocks: [] }, TZ)).toEqual({ eveningBefore: [], items: [] });
  });
});
