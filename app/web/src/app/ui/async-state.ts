import { ChangeDetectionStrategy, Component, computed, input, ViewEncapsulation } from '@angular/core';
import type { ViewState } from '../core/state/view-state';

@Component({
  selector: 'hr-async',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (state().kind === 'loading') {
      <div class="skeleton" data-testid="state-loading" aria-busy="true" aria-live="polite">
        <span></span>
        <span></span>
        <span></span>
      </div>
    } @else if (state().kind === 'error') {
      <p class="state-error" role="alert" data-testid="state-error">{{ errorDetail() }}</p>
    } @else {
      @if (refreshing()) {
        <p class="state-note">Refreshing</p>
      }
      @if (refreshError(); as detail) {
        <p class="state-note" role="status">{{ detail }}</p>
      }
      <ng-content />
    }
  `,
})
export class AsyncState {
  readonly state = input.required<ViewState<unknown>>();
  readonly errorDetail = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.detail : '';
  });
  readonly refreshing = computed(() => {
    const state = this.state();
    return state.kind === 'ready' && state.refreshing;
  });
  readonly refreshError = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.refreshError : null;
  });
}
