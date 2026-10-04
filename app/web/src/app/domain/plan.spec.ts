import type { ActionDto } from '@contracts';
import { PLAN_TOP, planView } from './plan';

const action = (id: string, impact: number, accepted = false): ActionDto => ({
  id,
  rule: 'sleep_target',
  title: id,
  evidence: '',
  evidenceRefs: [],
  impact,
  altersProjection: true,
  accepted,
});

const ranked = [action('A1', 24.1), action('A2', 24.1), action('A3', 24.1), action('A4', 16.2)];

describe('planView', () => {
  it('shows the top 3 actions collapsed', () => {
    const view = planView(ranked, false);

    expect(PLAN_TOP).toBe(3);
    expect(view.visible.map(a => a.id)).toEqual(['A1', 'A2', 'A3']);
    expect(view.hiddenCount).toBe(1);
  });

  it('keeps the api ranking instead of re-sorting by impact', () => {
    const serverOrder = [action('sleep', 10), action('training', 30), action('reset', 20), action('walk', 40)];

    expect(planView(serverOrder, true).visible.map(a => a.id)).toEqual(['sleep', 'training', 'reset', 'walk']);
  });

  it('reveals every action when expanded', () => {
    const view = planView(ranked, true);

    expect(view.visible.map(a => a.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(view.hiddenCount).toBe(0);
  });

  it('has nothing to show more of with 3 or fewer actions', () => {
    expect(planView(ranked.slice(0, 3), false).hiddenCount).toBe(0);
    expect(planView([], false)).toEqual({ visible: [], hiddenCount: 0, anyAccepted: false });
  });

  it('keeps accepted actions in place and reports that something was accepted', () => {
    const view = planView([action('A1', 24.1, true), ...ranked.slice(1)], false);

    expect(view.visible[0]?.id).toBe('A1');
    expect(view.anyAccepted).toBe(true);
  });

  it('counts accepted actions hidden behind "Show more"', () => {
    expect(planView([...ranked.slice(0, 3), action('A4', 16.2, true)], false).anyAccepted).toBe(true);
  });
});
