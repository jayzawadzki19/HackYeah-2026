import type { DayOutlookDto, GapLevel } from '@contracts';

/** Architecture 7.1 GAP_LEVELS: red >= 20, amber 8-20, green < 8 */
export const GAP_THRESHOLDS = { red: 20, amber: 8 } as const;

export const gapLevelFor = (gap: number | null): GapLevel | null =>
  gap === null ? null : gap >= GAP_THRESHOLDS.red ? 'red' : gap >= GAP_THRESHOLDS.amber ? 'amber' : 'green';

export const levelOf = (outlook: DayOutlookDto): GapLevel | null => outlook.gapLevel ?? gapLevelFor(outlook.gap);

export interface GapView {
  readonly current: DayOutlookDto;
  readonly level: GapLevel | null;
  /** the outlook before accepted actions, shown for comparison once a projection exists */
  readonly before: DayOutlookDto | null;
  readonly title: string;
  readonly sentence: string;
}

const wording = (gap: number | null, level: GapLevel | null): Pick<GapView, 'title' | 'sentence'> => {
  if (gap === null || level === null) {
    return { title: 'No capacity data', sentence: 'Without sleep, HRV or Body Battery data there is no capacity to compare with.' };
  }
  const points = Math.round(Math.abs(gap));
  if (level === 'red') return { title: 'Overloaded', sentence: `Tomorrow asks ${points} points more than you have.` };
  if (level === 'amber') return { title: 'Stretched', sentence: `Tomorrow asks ${points} points more than you have.` };
  return gap > 0
    ? { title: 'Within reach', sentence: `Tomorrow is ${points} points over your capacity, within reach.` }
    : { title: 'Headroom', sentence: `You have ${points} points of headroom for tomorrow.` };
};

export const gapView = (outlook: DayOutlookDto, projected: DayOutlookDto | null): GapView => {
  const current = projected ?? outlook;
  const level = levelOf(current);
  return { current, level, before: projected ? outlook : null, ...wording(current.gap, level) };
};
