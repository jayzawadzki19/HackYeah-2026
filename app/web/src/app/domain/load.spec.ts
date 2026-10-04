import { loadTone, meetingTypeLabel, pastTypeHeading } from './load';

describe('loadTone', () => {
  it.each([
    [83, 'high'],
    [70, 'high'],
    [69, 'medium'],
    [40, 'medium'],
    [39, 'low'],
    [0, 'low'],
  ] as const)('colours a load of %d as %s', (load, tone) => {
    expect(loadTone(load)).toBe(tone);
  });
});

describe('meeting type labels', () => {
  it('labels types for humans', () => {
    expect(meetingTypeLabel('one_on_one')).toBe('1:1');
    expect(meetingTypeLabel('product_review')).toBe('Product review');
  });

  it('builds the "Past board meetings" heading', () => {
    expect(pastTypeHeading('board')).toBe('Past board meetings');
    expect(pastTypeHeading('one_on_one')).toBe('Past 1:1 meetings');
  });
});
