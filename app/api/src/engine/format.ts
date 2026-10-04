import { localParts, weekdayOf } from './time';
import type { EpochMs, MeetingType } from './types';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const formatClock = (t: EpochMs, timeZone: string): string => {
  const { hour, minute } = localParts(t, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
};

/** 6.0833 -> "6h05" */
export const formatHoursMinutes = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}h${pad2(totalMinutes % 60)}`;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const weekdayName = (date: string): string => WEEKDAYS[weekdayOf(date)]!;

const TYPE_LABELS: Readonly<Record<MeetingType, string>> = {
  board: 'Board',
  pitch: 'Pitch',
  investor: 'Investor',
  customer: 'Customer',
  interview: 'Interview',
  product_review: 'Product review',
  one_on_one: '1:1',
  mentor: 'Mentor',
  team_sync: 'Team sync',
  standup: 'Standup',
};

const TYPE_PLURALS: Readonly<Record<MeetingType, string>> = {
  board: 'board meetings',
  pitch: 'pitches',
  investor: 'investor meetings',
  customer: 'customer meetings',
  interview: 'interviews',
  product_review: 'product reviews',
  one_on_one: '1:1s',
  mentor: 'mentor sessions',
  team_sync: 'team syncs',
  standup: 'standups',
};

export const typeLabel = (type: MeetingType): string => TYPE_LABELS[type];

/** Lower-case plural for mid-sentence use; `capitalize` it at the start of a sentence. */
export const typePlural = (type: MeetingType): string => TYPE_PLURALS[type];

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
