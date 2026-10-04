import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { HeadroomApi } from '../../core/api/headroom-api';
import { AsyncState } from '../../ui/async-state';
import { EnergyQuadrant } from './energy-quadrant';

@Component({
  selector: 'hr-energy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AsyncState, EnergyQuadrant],
  template: `
    <hr-async [state]="api.energyView()">
      @if (api.energyView(); as view) {
        @if (view.kind === 'ready') {
          <article class="page energy">
            <header class="lede">
              <p class="eyebrow">Private to you</p>
              <h1>What your body measured, against what you felt.</h1>
            </header>
            @if (view.value.people.length === 0) {
              <p class="empty">Not enough meetings to score anyone yet. Headroom waits for three.</p>
            } @else {
              <hr-energy-quadrant [people]="view.value.people" [selectedId]="selected()" (selectPerson)="selected.set($event)" />
              @if (chosen(); as person) {
                <section class="explain">
                  <p class="eyebrow">{{ person.person.name }}</p>
                  <p>{{ person.explanation }}</p>
                  <p class="fine">{{ person.meetings }} meetings · body {{ person.bodyEffect > 0 ? '+' : '' }}{{ person.bodyEffect }}</p>
                </section>
              }
            }
            <p class="footer-count">{{ view.value.belowThresholdCount }} people have fewer than 3 meetings - not scored</p>
          </article>
        }
      }
    </hr-async>
  `,
})
export class EnergyMapPage {
  protected readonly api = inject(HeadroomApi);
  readonly selected = signal<string | null>(null);
  readonly chosen = computed(() => {
    const view = this.api.energyView();
    if (view.kind !== 'ready') return null;
    return view.value.people.find(person => person.person.id === this.selected()) ?? null;
  });
}
