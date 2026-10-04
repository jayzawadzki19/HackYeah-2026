import { TestBed } from '@angular/core/testing';
import type { CapacityDto } from '@contracts';
import { CapacityCard } from './capacity-card';

const render = async (capacity: CapacityDto) => {
  const fixture = TestBed.createComponent(CapacityCard);
  fixture.componentRef.setInput('capacity', capacity);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const rows = () =>
    [...host.querySelectorAll<HTMLElement>('[data-testid="capacity-row"]')].map(row => ({
      label: row.querySelector('[data-testid="row-label"]')?.textContent?.trim(),
      value: row.querySelector('[data-testid="row-value"]')?.textContent?.trim(),
      detail: row.querySelector('[data-testid="row-detail"]')?.textContent?.trim(),
    }));
  return { host, rows };
};

describe('CapacityCard', () => {
  it('shows the capacity score and four component rows', async () => {
    const { host, rows } = await render({
      score: 54,
      components: [
        { kind: 'sleep', score: 81.1, weight: 0.35, detail: '6h05 last night (target 7h30)' },
        { kind: 'hrv', score: 25, weight: 0.3, detail: 'HRV 10% below your 7-day average' },
        { kind: 'bodyBattery', score: 41, weight: 0.25, detail: 'Body Battery 41 at wake-up' },
        { kind: 'resilience', score: 75, weight: 0.1, detail: 'Resilience 75 (open-wearables)' },
      ],
    });

    expect(host.querySelector('[data-testid="capacity-score"]')?.textContent?.trim()).toBe('54');
    expect(rows()).toEqual([
      { label: 'Sleep', value: '81', detail: '6h05 last night (target 7h30)' },
      { label: 'HRV', value: '25', detail: 'HRV 10% below your 7-day average' },
      { label: 'Body Battery', value: '41', detail: 'Body Battery 41 at wake-up' },
      { label: 'Resilience', value: '75', detail: 'Resilience 75 (open-wearables)' },
    ]);
  });

  it('renders "no data" for a null component, never 0 or NaN', async () => {
    const { host, rows } = await render({
      score: 32,
      components: [
        { kind: 'sleep', score: 62, weight: 0.39, detail: '4h40 last night (target 7h30)' },
        { kind: 'hrv', score: 5, weight: 0.33, detail: 'HRV 18% below your 7-day average' },
        { kind: 'bodyBattery', score: 24, weight: 0.28, detail: 'Body Battery 24 at wake-up' },
        { kind: 'resilience', score: null, weight: 0, detail: 'Not enough nights for a resilience score yet' },
      ],
    });

    expect(rows()[3]).toEqual({ label: 'Resilience', value: 'no data', detail: 'Not enough nights for a resilience score yet' });
    expect(host.textContent).not.toMatch(/NaN/);
  });

  it('says "no data" for the whole ring when no component has data', async () => {
    const { host, rows } = await render({ score: null, components: [] });

    expect(host.querySelector('[data-testid="capacity-score"]')?.textContent?.trim()).toBe('no data');
    expect(rows().map(r => r.value)).toEqual(['no data', 'no data', 'no data', 'no data']);
  });
});
