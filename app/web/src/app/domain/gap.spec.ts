import type { DayOutlookDto } from '@contracts';
import { gapLevelFor, gapView, levelOf } from './gap';

const outlook = (capacity: number | null, dayLoad: number, gapLevel: DayOutlookDto['gapLevel'] = null): DayOutlookDto => ({
  capacity,
  dayLoad,
  gap: capacity === null ? null : dayLoad - capacity,
  gapLevel,
});

describe('gapLevelFor', () => {
  it.each([
    [29, 'red'],
    [20, 'red'],
    [19.9, 'amber'],
    [15, 'amber'],
    [8, 'amber'],
    [7.9, 'green'],
    [0, 'green'],
    [-13, 'green'],
  ] as const)('maps a gap of %d to %s', (gap, level) => {
    expect(gapLevelFor(gap)).toBe(level);
  });

  it('has no level without a gap', () => {
    expect(gapLevelFor(null)).toBeNull();
  });
});

describe('levelOf', () => {
  it('trusts the level sent by the api', () => {
    expect(levelOf(outlook(60, 75, 'amber'))).toBe('amber');
  });

  it('derives the level from the gap when the api sends none', () => {
    expect(levelOf(outlook(54, 83))).toBe('red');
  });

  it('has no level when capacity is unknown', () => {
    expect(levelOf(outlook(null, 83))).toBeNull();
  });
});

describe('gapView', () => {
  it('shows the outlook when nothing is accepted', () => {
    const view = gapView(outlook(54, 83, 'red'), null);

    expect(view.current.gap).toBe(29);
    expect(view.level).toBe('red');
    expect(view.before).toBeNull();
    expect(view.title).toBe('Overloaded');
    expect(view.sentence).toBe('Tomorrow asks 29 points more than you have.');
  });

  it('shows the projection and keeps the outlook as "before" once actions are accepted', () => {
    const view = gapView(outlook(54, 83, 'red'), outlook(60, 75, 'amber'));

    expect(view.current.gap).toBe(15);
    expect(view.level).toBe('amber');
    expect(view.before?.gap).toBe(29);
    expect(view.title).toBe('Stretched');
  });

  it('describes spare capacity as headroom', () => {
    const view = gapView(outlook(40, 18, 'green'), null);

    expect(view.title).toBe('Headroom');
    expect(view.sentence).toBe('You have 22 points of headroom for tomorrow.');
  });

  it('describes a small positive gap as within reach', () => {
    expect(gapView(outlook(50, 55, 'green'), null).title).toBe('Within reach');
  });

  it('explains a missing capacity instead of inventing a gap', () => {
    const view = gapView(outlook(null, 83), null);

    expect(view.level).toBeNull();
    expect(view.title).toBe('No capacity data');
  });
});
