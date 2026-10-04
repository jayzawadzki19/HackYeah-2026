import { ChangeDetectionStrategy, Component, computed, input, ViewEncapsulation } from '@angular/core';
import type { DayOutlookDto } from '@contracts';
import { scoreText } from '../../domain/capacity';
import { gapView } from '../../domain/gap';
import { shortDate } from '../../domain/time';

const formatGap = (gap: number | null): string => {
  if (gap === null || !Number.isFinite(gap)) return 'no data';
  const rounded = Math.round(gap);
  return rounded > 0 ? `+${rounded}` : String(rounded);
};

@Component({
  selector: 'hr-headroom-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="gauge" data-testid="gauge" [attr.data-level]="view().level ?? 'none'">
      <p class="kicker" data-testid="gap-title">{{ view().title }}</p>
      <p class="gap-value" data-testid="gap-value">{{ gapText() }}</p>
      <p class="sentence">{{ view().sentence }}</p>
      @if (beforeGap() !== null) {
        <p class="before" data-testid="gap-before">was {{ beforeGap() }}</p>
      }
      <div class="track" data-testid="gauge-track" [style.--cap]="trackCap()" [style.--load]="trackLoad()">
        <span class="fill"></span>
        <span class="ceiling"></span>
      </div>
      <div class="pair">
        <p><span class="pair-label">Capacity</span> <strong data-testid="capacity-value">{{ capacityText() }}</strong></p>
        <p><span class="pair-label">Tomorrow</span> <strong data-testid="load-value">{{ loadText() }}</strong></p>
      </div>
      <p class="when">{{ dateLabel() }}</p>
    </section>
  `,
})
export class HeadroomGauge {
  readonly outlook = input.required<DayOutlookDto>();
  readonly projected = input<DayOutlookDto | null>(null);
  readonly date = input.required<string>();

  readonly view = computed(() => gapView(this.outlook(), this.projected()));
  readonly gapText = computed(() => formatGap(this.view().current.gap));
  readonly capacityText = computed(() => scoreText(this.view().current.capacity));
  readonly loadText = computed(() => scoreText(this.view().current.dayLoad));
  readonly beforeGap = computed(() => {
    const before = this.view().before;
    return before ? formatGap(before.gap) : null;
  });
  readonly trackCap = computed(() => {
    const capacity = this.view().current.capacity;
    return capacity === null ? '0' : String(Math.round(capacity));
  });
  readonly trackLoad = computed(() => String(Math.round(this.view().current.dayLoad)));
  readonly dateLabel = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.date()) ? shortDate(this.date()) : this.date()));
}
