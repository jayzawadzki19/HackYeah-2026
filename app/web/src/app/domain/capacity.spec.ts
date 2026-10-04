import type { CapacityDto } from '@contracts';
import { capacityRows, scoreText } from './capacity';

const marta: CapacityDto = {
  score: 54,
  components: [
    { kind: 'hrv', score: 25, weight: 0.3, detail: 'HRV 10% below your 7-day average' },
    { kind: 'sleep', score: 81.1, weight: 0.35, detail: '6h05 last night (target 7h30)' },
    { kind: 'resilience', score: 75, weight: 0.1, detail: 'Resilience 75 (open-wearables)' },
    { kind: 'bodyBattery', score: 41, weight: 0.25, detail: 'Body Battery 41 at wake-up' },
  ],
};

describe('scoreText', () => {
  it('rounds a score', () => {
    expect(scoreText(81.1)).toBe('81');
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('says "no data" for %s instead of a number', score => {
    expect(scoreText(score)).toBe('no data');
  });
});

describe('capacityRows', () => {
  it('lists the four components in a fixed order with labels', () => {
    expect(capacityRows(marta).map(r => [r.label, r.value])).toEqual([
      ['Sleep', '81'],
      ['HRV', '25'],
      ['Body Battery', '41'],
      ['Resilience', '75'],
    ]);
  });

  it('shows weights as whole percentages', () => {
    expect(capacityRows(marta).map(r => r.weightPct)).toEqual([35, 30, 25, 10]);
  });

  it('labels a null component "no data" and gives it no weight', () => {
    const rows = capacityRows({
      score: 32,
      components: [
        ...marta.components.filter(c => c.kind !== 'resilience'),
        { kind: 'resilience', score: null, weight: 0, detail: 'Not enough nights for a resilience score yet' },
      ],
    });
    const resilience = rows.find(r => r.kind === 'resilience');

    expect(resilience).toMatchObject({ value: 'no data', hasData: false, weightPct: null, detail: 'Not enough nights for a resilience score yet' });
  });

  it('still lists a component the api left out, as "no data"', () => {
    const rows = capacityRows({ score: null, components: [] });

    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.value === 'no data' && !r.hasData)).toBe(true);
    expect(rows[0]?.detail).toBe('No sleep data');
  });
});
