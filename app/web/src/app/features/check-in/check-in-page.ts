import { ChangeDetectionStrategy, Component, inject, signal, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Rating, ReflectionResultDto } from '@contracts';
import { problemDetail } from '../../core/api/problem';
import { HeadroomApi } from '../../core/api/headroom-api';
import { Toasts } from '../../core/ui/toasts';
import { checkInQuestion } from '../../domain/briefing';
import { AsyncState } from '../../ui/async-state';

@Component({
  selector: 'hr-check-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AsyncState, RouterLink],
  template: `
    <hr-async [state]="api.pendingView()">
      @if (api.pendingView(); as view) {
        @if (view.kind === 'ready') {
          <article class="page checkin">
            @if (result(); as done) {
              <header class="lede">
                <p class="eyebrow">One tap</p>
                <h1>Checked in.</h1>
              </header>
              <section class="explain">
                <p>{{ done.message }}</p>
                <a class="commit" [routerLink]="['/', api.user(), 'energy-map']">See the energy map</a>
              </section>
            } @else if (view.value.length === 0) {
              <header class="lede">
                <p class="eyebrow">One tap</p>
                <h1>You are up to date.</h1>
              </header>
              <p class="empty">No check-in is waiting.</p>
            } @else {
              <header class="lede">
                <p class="eyebrow">One tap</p>
                <h1>{{ question(view.value[0]!) }}</h1>
              </header>
              <section class="prompt">
                <div class="choices">
                  <button type="button" (click)="choose(view.value[0]!.meetingId, -1)" [disabled]="busy()">drained</button>
                  <button type="button" (click)="choose(view.value[0]!.meetingId, 0)" [disabled]="busy()">neutral</button>
                  <button type="button" (click)="choose(view.value[0]!.meetingId, 1)" [disabled]="busy()">energized</button>
                </div>
              </section>
            }
          </article>
        }
      }
    </hr-async>
  `,
})
export class CheckInPage {
  protected readonly api = inject(HeadroomApi);
  private readonly toasts = inject(Toasts);
  readonly result = signal<ReflectionResultDto | null>(null);
  readonly busy = signal(false);

  question(card: { title: string; start: string }): string {
    const briefing = this.api.briefingView();
    const zone = briefing.kind === 'ready' ? briefing.value.user.timeZone : 'Europe/Warsaw';
    return checkInQuestion(card, zone);
  }

  choose(meetingId: string, rating: Rating): void {
    this.busy.set(true);
    this.api.reflect(meetingId, rating).subscribe({
      next: result => {
        this.result.set(result);
        this.busy.set(false);
      },
      error: error => {
        this.busy.set(false);
        this.toasts.push(problemDetail(error));
      },
    });
  }
}
