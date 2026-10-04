import { ChangeDetectionStrategy, Component, computed, inject, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { problemDetail } from '../../core/api/problem';
import { HeadroomApi } from '../../core/api/headroom-api';
import { LiveStreamService } from '../../core/live/live-stream.service';
import { Toasts } from '../../core/ui/toasts';
import { briefingFocus } from '../../domain/briefing';
import { liveReadout } from '../../domain/live';
import { planView } from '../../domain/plan';
import { dayLabel, localDate, timeOf } from '../../domain/time';
import { AsyncState } from '../../ui/async-state';
import { ActionPlan } from './action-plan';
import { CapacityCard } from './capacity-card';
import { HeadroomGauge } from './headroom-gauge';

@Component({
  selector: 'hr-briefing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AsyncState, HeadroomGauge, CapacityCard, ActionPlan, RouterLink, NgxEchartsDirective],
  template: `
    <hr-async [state]="api.briefingView()">
      @if (api.briefingView(); as view) {
        @if (view.kind === 'ready') {
          <article class="page briefing">
            @if (view.value.stale) {
              <p class="stale" data-testid="stale">Stale snapshot</p>
            }
            <header class="lede">
              <p class="eyebrow">{{ focus() === 'tomorrow' ? 'For tomorrow' : 'Right now' }}</p>
              <h1>{{ view.value.headline }}</h1>
            </header>
            <hr-headroom-gauge [outlook]="view.value.outlook" [projected]="view.value.projected" [date]="view.value.tomorrow.date" />
            <hr-capacity-card [capacity]="view.value.capacity" />
            <section class="plan-block fold">
              <h2>Your plan for tomorrow</h2>
              @if (view.value.actions.length === 0) {
                <p class="empty">No changes suggested. Tomorrow is inside your capacity.</p>
              } @else {
                <hr-action-plan [actions]="view.value.actions" [userKey]="view.value.user.key" (accept)="onAccept($event)" />
              }
              @if (accepted()) {
                <p class="fine">Estimates only change what the plan changes: sleep and training</p>
              }
            </section>
            <section class="coming fold">
              <h2>Coming up</h2>
              @if (view.value.upcoming.length === 0) {
                <p class="empty">Nothing in the next 24 hours.</p>
              } @else {
                <ol class="agenda">
                  @for (item of view.value.upcoming; track item.id) {
                    <li>
                      <a [routerLink]="['/', view.value.user.key, 'meetings', item.id]">
                        <span class="when">{{ clock(item.start) }}</span>
                        <span class="what">
                          <strong>{{ item.title }}</strong>
                          <em>{{ item.basis.label }}</em>
                        </span>
                        <span class="load" [attr.data-tone]="tone(item.predictedLoad)">{{ item.predictedLoad }}</span>
                      </a>
                    </li>
                  }
                </ol>
              }
            </section>
            @if (view.value.live; as live) {
              <section class="live-tile fold">
                <header>
                  <h2>On the wrist</h2>
                  <button type="button" class="commit" (click)="sync()" [disabled]="syncing()">
                    {{ syncing() ? 'Syncing...' : 'Sync now' }}
                  </button>
                </header>
                @if (readout(); as now) {
                  <p class="readout">{{ now.text }}</p>
                } @else {
                  <p class="empty">No sample in the last 3 hours.</p>
                }
                <div class="spark" echarts [options]="spark()"></div>
              </section>
            }
          </article>
        }
      }
    </hr-async>
  `,
})
export class BriefingPage {
  protected readonly api = inject(HeadroomApi);
  private readonly stream = inject(LiveStreamService);
  private readonly toasts = inject(Toasts);

  readonly focus = computed(() => {
    const view = this.api.briefingView();
    return view.kind === 'ready' ? briefingFocus(view.value) : 'now';
  });
  readonly accepted = computed(() => {
    const view = this.api.briefingView();
    return view.kind === 'ready' && planView(view.value.actions, true).anyAccepted;
  });
  readonly readout = computed(() => {
    const view = this.api.briefingView();
    return view.kind === 'ready' && view.value.live ? liveReadout(view.value.live.points) : null;
  });
  readonly syncing = computed(() => this.stream.sync()?.state === 'running');
  readonly spark = computed((): EChartsCoreOption => {
    const view = this.api.briefingView();
    const points = view.kind === 'ready' ? (view.value.live?.points ?? []) : [];
    return {
      animationDuration: 600,
      grid: { left: 0, right: 0, top: 8, bottom: 0 },
      xAxis: { type: 'time', show: false },
      yAxis: { type: 'value', show: false, min: 'dataMin' },
      series: [
        {
          type: 'line',
          data: points.filter(point => point.stress !== null).map(point => [point.t, point.stress]),
          showSymbol: false,
          lineStyle: { color: '#e7b2ad', width: 1.6 },
          areaStyle: { color: 'rgba(231, 178, 173, 0.2)' },
        },
      ],
    };
  });

  clock(iso: string): string {
    const view = this.api.briefingView();
    const zone = view.kind === 'ready' ? view.value.user.timeZone : 'Europe/Warsaw';
    const today = view.kind === 'ready' ? localDate(view.value.computedAt, zone) : localDate(new Date().toISOString(), zone);
    return `${dayLabel(localDate(iso, zone), today)} ${timeOf(iso, zone)}`;
  }

  tone(load: number): string {
    return load >= 70 ? 'high' : load >= 40 ? 'medium' : 'low';
  }

  onAccept(actionId: string): void {
    this.api.accept(actionId).subscribe({
      next: () => this.toasts.push('Added to calendar'),
      error: error => this.toasts.push(problemDetail(error)),
    });
  }

  sync(): void {
    this.api.syncNow().subscribe({ error: error => this.toasts.push(problemDetail(error)) });
  }
}
