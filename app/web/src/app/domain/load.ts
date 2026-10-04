import type { MeetingType } from '@contracts';

export type LoadTone = 'high' | 'medium' | 'low';

/** 70 and above reads as a heavy block, 40-69 as a working block, below 40 as light. */
export const loadTone = (load: number): LoadTone => (load >= 70 ? 'high' : load >= 40 ? 'medium' : 'low');

const LABELS: Record<MeetingType, string> = {
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

export const meetingTypeLabel = (type: MeetingType): string => LABELS[type];

export const pastTypeHeading = (type: MeetingType): string => `Past ${meetingTypeLabel(type).toLowerCase()} meetings`;
