import { ChangeDetectionStrategy, Component, input, output, ViewEncapsulation } from '@angular/core';
import type { EnergyGroup, EnergyMapEntryDto } from '@contracts';
import { plotPosition } from '../../domain/quadrant';

const GROUP_LABEL: Record<EnergyGroup, string> = {
  known_drain: 'Known drain',
  hidden_drain: 'Hidden drain',
  energizer: 'Energizer',
  overestimated: 'Overestimated',
  neutral: 'Neutral',
};

@Component({
  selector: 'hr-energy-quadrant',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="plot">
      <span class="qlabel" data-testid="quadrant-label">Energizer</span>
      <span class="qlabel" data-testid="quadrant-label">Hidden drain</span>
      <span class="qlabel" data-testid="quadrant-label">Overestimated</span>
      <span class="qlabel" data-testid="quadrant-label">Known drain</span>
      @for (person of people(); track person.person.id) {
        <button
          type="button"
          [attr.data-person]="person.person.id"
          [attr.data-group]="person.group"
          [attr.aria-pressed]="selectedId() === person.person.id ? 'true' : 'false'"
          [attr.aria-label]="person.person.name + ' - ' + label(person.group)"
          [style.left.%]="position(person).x"
          [style.bottom.%]="position(person).y"
          (click)="selectPerson.emit(person.person.id)"
        >
          {{ person.person.name.split(' ')[0] }}
        </button>
      }
    </div>
  `,
})
export class EnergyQuadrant {
  readonly people = input.required<readonly EnergyMapEntryDto[]>();
  readonly selectedId = input<string | null>(null);
  readonly selectPerson = output<string>();

  readonly label = (group: EnergyGroup): string => GROUP_LABEL[group];
  readonly position = (person: EnergyMapEntryDto): { x: number; y: number } => plotPosition(person.bodyEffect, person.felt);
}
