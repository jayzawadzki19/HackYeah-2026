import type { WeekDayDto } from '@contracts';
import { loadTone, type LoadTone } from './load';
import { localDate } from './time';

export interface TimelineItem {
  readonly id: string;
  readonly kind: 'meeting' | 'workout' | 'block';
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly minutes: number;
  readonly load: number | null;
  readonly tone: LoadTone | 'added';
  readonly movedByHeadroom: boolean;
}

export interface DayTimeline {
  readonly eveningBefore: readonly TimelineItem[];
  readonly items: readonly TimelineItem[];
}

const minutesBetween = (start: string, end: string): number => Math.round((Date.parse(end) - Date.parse(start)) / 60_000);

const byStart = (a: TimelineItem, b: TimelineItem): number => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

export const dayTimeline = (day: WeekDayDto, timeZone: string): DayTimeline => {
  const items: TimelineItem[] = [
    ...day.meetings.map(meeting => ({
      id: meeting.id,
      kind: 'meeting' as const,
      title: meeting.title,
      start: meeting.start,
      end: meeting.end,
      minutes: minutesBetween(meeting.start, meeting.end),
      load: meeting.predictedLoad,
      tone: loadTone(meeting.predictedLoad),
      movedByHeadroom: false,
    })),
    ...day.workouts.map(workout => ({
      id: workout.id,
      kind: 'workout' as const,
      title: workout.title,
      start: workout.start,
      end: workout.end,
      minutes: minutesBetween(workout.start, workout.end),
      load: workout.load,
      tone: 'low' as const,
      movedByHeadroom: workout.movedByHeadroom,
    })),
    ...day.blocks.map(block => ({
      id: block.id,
      kind: 'block' as const,
      title: block.title,
      start: block.start,
      end: block.end,
      minutes: minutesBetween(block.start, block.end),
      load: null,
      tone: 'added' as const,
      movedByHeadroom: true,
    })),
  ];

  const eveningBefore = items.filter(item => item.kind === 'block' && localDate(item.start, timeZone) < day.date).sort(byStart);
  const onTheDay = items.filter(item => !eveningBefore.includes(item)).sort(byStart);
  return { eveningBefore, items: onTheDay };
};
