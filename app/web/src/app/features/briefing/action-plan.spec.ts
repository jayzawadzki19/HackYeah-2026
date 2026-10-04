import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ActionDto } from '@contracts';
import { ActionPlan } from './action-plan';

const action = (id: string, title: string, extra: Partial<ActionDto> = {}): ActionDto => ({
  id,
  rule: 'sleep_target',
  title,
  evidence: `Evidence for ${title}`,
  evidenceRefs: [],
  impact: 24.1,
  altersProjection: true,
  accepted: false,
  ...extra,
});

const actions: readonly ActionDto[] = [
  action('A1', 'Lights out by 22:45'),
  action('A2', "Move tomorrow's intervals to Saturday", {
    rule: 'training_swap',
    evidence: 'The last 3 times you did hard training before a heavy day, your HRV dropped about 15% the next night.',
    evidenceRefs: [
      { label: 'HRV -16%', date: '2026-08-27' },
      { label: 'HRV -14%', date: '2026-09-10' },
      { label: 'HRV -15%', date: '2026-09-24' },
    ],
  }),
  action('A3', '10-minute walk at 09:45 before the Board meeting', { rule: 'pre_meeting_reset', altersProjection: false }),
  action('A4', 'Make the 1:1 with Piotr a 30-minute walking meeting at 12:15', {
    rule: 'buffer_walking',
    altersProjection: false,
    impact: 16.2,
    evidenceRefs: [{ label: 'Energy map', link: 'energy-map' }],
  }),
];

const render = async (list: readonly ActionDto[] = actions) => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ActionPlan);
  fixture.componentRef.setInput('actions', list);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const titles = () => [...host.querySelectorAll('[data-testid="action-title"]')].map(e => e.textContent?.trim());
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
  return { fixture, host, titles, button };
};

describe('ActionPlan', () => {
  it('shows exactly the top 3 actions in the api order', async () => {
    const { titles } = await render();

    expect(titles()).toEqual(['Lights out by 22:45', "Move tomorrow's intervals to Saturday", '10-minute walk at 09:45 before the Board meeting']);
  });

  it('reveals the 4th action with "Show more" and hides it again with "Show less"', async () => {
    const { fixture, titles, button } = await render();

    button('Show more')?.click();
    await fixture.whenStable();
    expect(titles()).toHaveLength(4);
    expect(titles()[3]).toBe('Make the 1:1 with Piotr a 30-minute walking meeting at 12:15');

    button('Show less')?.click();
    await fixture.whenStable();
    expect(titles()).toHaveLength(3);
  });

  it('offers no "Show more" with 3 or fewer actions', async () => {
    const { button } = await render(actions.slice(0, 2));

    expect(button('Show more')).toBeUndefined();
  });

  it('expands the evidence and its dates with "Why?"', async () => {
    const { fixture, host } = await render();
    const card = host.querySelectorAll<HTMLElement>('[data-testid="action"]')[1];
    const why = [...(card?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === 'Why?');

    expect(why?.getAttribute('aria-expanded')).toBe('false');
    why?.click();
    await fixture.whenStable();

    expect(why?.getAttribute('aria-expanded')).toBe('true');
    expect(card?.textContent).toContain('your HRV dropped about 15% the next night');
    expect([...(card?.querySelectorAll('[data-testid="evidence-ref"]') ?? [])].map(e => e.textContent?.trim())).toEqual([
      'HRV -16% · Thu 27 Aug',
      'HRV -14% · Thu 10 Sep',
      'HRV -15% · Thu 24 Sep',
    ]);
  });

  it('links an Energy map reference to the energy map', async () => {
    const { fixture, host, button } = await render();
    button('Show more')?.click();
    await fixture.whenStable();
    const card = host.querySelectorAll<HTMLElement>('[data-testid="action"]')[3];
    [...(card?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === 'Why?')?.click();
    await fixture.whenStable();

    expect(card?.querySelector('a[data-testid="evidence-ref"]')?.getAttribute('href')).toContain('energy-map');
  });

  it('emits the action id from "Add to plan"', async () => {
    const { fixture } = await render();
    const accepted: string[] = [];
    fixture.componentInstance.accept.subscribe(id => accepted.push(id));
    const host = fixture.nativeElement as HTMLElement;

    [...host.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Add to plan')[1]?.click();

    expect(accepted).toEqual(['A2']);
  });

  it('shows accepted actions as added instead of offering them again', async () => {
    const { host } = await render([{ ...actions[0]!, accepted: true }, ...actions.slice(1)]);
    const first = host.querySelector<HTMLElement>('[data-testid="action"]');

    expect(first?.textContent).toContain('Added to calendar');
    expect([...(first?.querySelectorAll('button') ?? [])].some(b => b.textContent?.trim() === 'Add to plan')).toBe(false);
  });
});
