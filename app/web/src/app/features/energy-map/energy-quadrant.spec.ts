import { TestBed } from '@angular/core/testing';
import type { EnergyGroup, EnergyMapEntryDto } from '@contracts';
import { EnergyQuadrant } from './energy-quadrant';

const entry = (id: string, name: string, bodyEffect: number, felt: number | null, group: EnergyGroup): EnergyMapEntryDto => ({
  person: { id, name, role: null },
  meetings: 6,
  bodyEffect,
  felt,
  reflections: felt === null ? 0 : 4,
  group,
  confidence: 'high',
  explanation: '',
});

const people = [
  entry('anna', 'Anna Kowalska', 13.6, -0.67, 'known_drain'),
  entry('piotr', 'Piotr Nowak', 11.8, 0, 'hidden_drain'),
  entry('ola', 'Ola Wiśniewska', -6.1, 0.75, 'energizer'),
  entry('tomasz', 'Tomasz Lewandowski', 0.8, -0.75, 'overestimated'),
  entry('kasia', 'Kasia Wójcik', 0.3, 0, 'neutral'),
];

const render = async (list: readonly EnergyMapEntryDto[] = people) => {
  const fixture = TestBed.createComponent(EnergyQuadrant);
  fixture.componentRef.setInput('people', list);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const dot = (id: string) => host.querySelector<HTMLElement>(`[data-person="${id}"]`);
  const position = (id: string) => ({ x: Number.parseFloat(dot(id)?.style.left ?? 'NaN'), y: Number.parseFloat(dot(id)?.style.bottom ?? 'NaN') });
  return { fixture, host, dot, position };
};

describe('EnergyQuadrant', () => {
  it('labels the four quadrants', async () => {
    const { host } = await render();
    const labels = [...host.querySelectorAll('[data-testid="quadrant-label"]')].map(e => e.textContent?.trim());

    expect(labels).toEqual(expect.arrayContaining(['Known drain', 'Hidden drain', 'Energizer', 'Overestimated']));
  });

  it('renders one accessible button per scored person', async () => {
    const { dot, host } = await render();

    expect(host.querySelectorAll('button[data-person]')).toHaveLength(5);
    expect(dot('piotr')?.getAttribute('aria-label')).toBe('Piotr Nowak - Hidden drain');
  });

  it.each([
    ['anna', true, false],
    ['piotr', true, true],
    ['ola', false, true],
    ['tomasz', false, false],
  ] as const)('places %s in the matching quadrant', async (id, right, top) => {
    const { position } = await render();
    const { x, y } = position(id);

    expect(x > 50).toBe(right);
    expect(y > 50).toBe(top);
  });

  it('marks each dot with its group so colours follow the group', async () => {
    const { dot } = await render();

    expect(dot('kasia')?.dataset['group']).toBe('neutral');
    expect(dot('anna')?.dataset['group']).toBe('known_drain');
  });

  it('moves a dot upward when the person feels more energized', async () => {
    const { fixture, position } = await render();
    const before = position('piotr').y;

    fixture.componentRef.setInput('people', people.map(p => (p.person.id === 'piotr' ? { ...p, felt: 0.25 } : p)));
    await fixture.whenStable();

    expect(position('piotr').y).toBeGreaterThan(before);
  });

  it('emits the selected person and marks the selection', async () => {
    const { fixture, dot } = await render();
    const selected: string[] = [];
    fixture.componentInstance.selectPerson.subscribe(id => selected.push(id));

    dot('kasia')?.click();
    fixture.componentRef.setInput('selectedId', 'kasia');
    await fixture.whenStable();

    expect(selected).toEqual(['kasia']);
    expect(dot('kasia')?.getAttribute('aria-pressed')).toBe('true');
    expect(dot('anna')?.getAttribute('aria-pressed')).toBe('false');
  });
});
