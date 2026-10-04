import { TestBed } from '@angular/core/testing';
import type { DayOutlookDto } from '@contracts';
import { HeadroomGauge } from './headroom-gauge';

const outlook: DayOutlookDto = { capacity: 54, dayLoad: 83, gap: 29, gapLevel: 'red' };
const projected: DayOutlookDto = { capacity: 60, dayLoad: 75, gap: 15, gapLevel: 'amber' };

const render = async (inputs: { outlook: DayOutlookDto; projected?: DayOutlookDto | null }) => {
  const fixture = TestBed.createComponent(HeadroomGauge);
  fixture.componentRef.setInput('outlook', inputs.outlook);
  fixture.componentRef.setInput('projected', inputs.projected ?? null);
  fixture.componentRef.setInput('date', '2026-10-05');
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const query = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  return { fixture, host, query };
};

describe('HeadroomGauge', () => {
  it('shows a red gap of +29 for tomorrow', async () => {
    const { query } = await render({ outlook });

    expect(query('gauge')?.dataset['level']).toBe('red');
    expect(query('gap-value')?.textContent?.trim()).toBe('+29');
    expect(query('gap-title')?.textContent?.trim()).toBe('Overloaded');
    expect(query('capacity-value')?.textContent?.trim()).toBe('54');
    expect(query('load-value')?.textContent?.trim()).toBe('83');
  });

  it('places the capacity ceiling and the load on the track', async () => {
    const { query } = await render({ outlook });
    const track = query('gauge-track');

    expect(track?.style.getPropertyValue('--cap')).toBe('54');
    expect(track?.style.getPropertyValue('--load')).toBe('83');
  });

  it('switches to the amber projection once actions are accepted and remembers the original gap', async () => {
    const { fixture, query } = await render({ outlook });

    fixture.componentRef.setInput('projected', projected);
    await fixture.whenStable();

    expect(query('gauge')?.dataset['level']).toBe('amber');
    expect(query('gap-value')?.textContent?.trim()).toBe('+15');
    expect(query('gap-before')?.textContent).toContain('29');
    expect(query('gauge-track')?.style.getPropertyValue('--cap')).toBe('60');
  });

  it('shows a green headroom without a plus sign', async () => {
    const { query } = await render({ outlook: { capacity: 40, dayLoad: 18, gap: -22, gapLevel: 'green' } });

    expect(query('gauge')?.dataset['level']).toBe('green');
    expect(query('gap-value')?.textContent?.trim()).toBe('-22');
  });

  it('says "no data" instead of a gap when capacity is unknown', async () => {
    const { query } = await render({ outlook: { capacity: null, dayLoad: 83, gap: null, gapLevel: null } });

    expect(query('gauge')?.dataset['level']).toBe('none');
    expect(query('gap-value')?.textContent?.trim()).toBe('no data');
    expect(query('capacity-value')?.textContent?.trim()).toBe('no data');
  });
});
