import { ChangeDetectionStrategy, Component, computed, input, ViewEncapsulation } from '@angular/core';
import type { CapacityDto } from '@contracts';
import { capacityRows, scoreText } from '../../domain/capacity';

@Component({
  selector: 'hr-capacity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="capacity">
      <p class="score"><span>Last night</span><span data-testid="capacity-score">{{ scoreText(capacity().score) }}</span></p>
      <ol>
        @for (row of rows(); track row.kind) {
          <li data-testid="capacity-row" [attr.data-kind]="row.kind">
            <span data-testid="row-label">{{ row.label }}</span>
            <span data-testid="row-value">{{ row.value }}</span>
            <span data-testid="row-detail">{{ row.detail }}</span>
          </li>
        }
      </ol>
    </section>
  `,
})
export class CapacityCard {
  readonly capacity = input.required<CapacityDto>();
  readonly scoreText = scoreText;
  readonly rows = computed(() => capacityRows(this.capacity()));
}
