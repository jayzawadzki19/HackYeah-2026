import { NEUTRAL_ZONE, plotPosition, regionOf } from './quadrant';

const people = {
  anna: { bodyEffect: 13.6, felt: -0.67 },
  piotr: { bodyEffect: 11.8, felt: 0 },
  ola: { bodyEffect: -6.1, felt: 0.75 },
  tomasz: { bodyEffect: 0.8, felt: -0.75 },
  kasia: { bodyEffect: 0.3, felt: 0 },
} as const;

describe('regionOf', () => {
  it.each([
    ['anna', 'known_drain'],
    ['piotr', 'hidden_drain'],
    ['ola', 'energizer'],
    ['tomasz', 'overestimated'],
    ['kasia', 'neutral'],
  ] as const)('puts %s in %s (architecture 7.7 thresholds)', (name, region) => {
    const { bodyEffect, felt } = people[name];
    expect(regionOf(bodyEffect, felt)).toBe(region);
  });

  it('uses the exact threshold values', () => {
    expect(regionOf(4, -0.25)).toBe('known_drain');
    expect(regionOf(4, -0.24)).toBe('hidden_drain');
    expect(regionOf(3.9, -0.25)).toBe('overestimated');
    expect(regionOf(-3, 0)).toBe('energizer');
    expect(regionOf(0, 0.25)).toBe('energizer');
    expect(regionOf(-2.9, 0.24)).toBe('neutral');
  });

  it('treats a person without check-ins as neither drained nor energized', () => {
    expect(regionOf(12, null)).toBe('hidden_drain');
    expect(regionOf(0, null)).toBe('neutral');
  });
});

describe('plotPosition', () => {
  const inQuadrant = (name: keyof typeof people) => {
    const { x, y } = plotPosition(people[name].bodyEffect, people[name].felt);
    return { right: x > 50, top: y > 50 };
  };

  it('places drains on the right and energizers on the left', () => {
    expect(inQuadrant('anna')).toEqual({ right: true, top: false });
    expect(inQuadrant('piotr')).toEqual({ right: true, top: true });
    expect(inQuadrant('ola')).toEqual({ right: false, top: true });
    expect(inQuadrant('tomasz')).toEqual({ right: false, top: false });
  });

  it('centres the crossing on the group thresholds', () => {
    expect(plotPosition(4, -0.25)).toEqual({ x: 50, y: 50 });
  });

  it('lands a neutral person inside the neutral zone near the centre', () => {
    const { x, y } = plotPosition(people.kasia.bodyEffect, people.kasia.felt);

    expect(x).toBeGreaterThan(NEUTRAL_ZONE.left);
    expect(x).toBeLessThan(NEUTRAL_ZONE.left + NEUTRAL_ZONE.width);
    expect(y).toBeGreaterThan(NEUTRAL_ZONE.bottom);
    expect(y).toBeLessThan(NEUTRAL_ZONE.bottom + NEUTRAL_ZONE.height);
  });

  it('moves a dot up when the person feels more energized', () => {
    expect(plotPosition(11.8, 0.25).y).toBeGreaterThan(plotPosition(11.8, 0).y + 5);
  });

  it('clamps extreme values inside the plot', () => {
    const top = plotPosition(80, 3);
    const bottom = plotPosition(-80, -3);

    expect(top.x).toBeLessThanOrEqual(94);
    expect(top.y).toBeLessThanOrEqual(94);
    expect(bottom.x).toBeGreaterThanOrEqual(6);
    expect(bottom.y).toBeGreaterThanOrEqual(6);
  });
});
