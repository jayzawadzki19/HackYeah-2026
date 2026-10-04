import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsCoreOption, ECElementEvent } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { HeadroomApi } from '../../core/api/headroom-api';
import { dayTimeline } from '../../domain/timeline';
import { dayLabel, durationText, shortDate, timeOf } from '../../domain/time';
import { AsyncState } from '../../ui/async-state';

@Component({
  selector: 'hr-week-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AsyncState, NgxEchartsDirective, RouterLink],
  template: `
    <hr-async [state]="api.weekView()">
      @if (api.weekView(); as view) {
        @if (view.kind === 'ready') {
          <article class="page week">
            @if (view.value.stale) {
              <p class="stale" data-testid="stale">Stale snapshot</p>
            }
            <header class="lede">
              <p class="eyebrow">Seven days</p>
              <h1>The week, against your capacity.</h1>
            </header>
            @if (view.value.days.length === 0) {
              <p class="empty">No week forecast yet.</p>
            } @else {
              <div class="chart" echarts [options]="chart()" (chartClick)="pick($event)"></div>
              <div class="day-row" role="tablist">
                @for (day of view.value.days; track day.date) {
                  <button type="button" role="tab" [class.is-on]="day.date === active()" [attr.aria-selected]="day.date === active()" [attr.aria-label]="chip(day.date)" (click)="selected.set(day.date)">
                    <span>{{ weekday(day.date) }}</span>
                    <span>{{ dayNumber(day.date) }}</span>
                  </button>
                }
              </div>
              @if (timeline(); as line) {
                <section class="timeline">
                  <h2>{{ heading() }}</h2>
                  @if (line.eveningBefore.length === 0 && line.items.length === 0) {
                    <p class="empty">A clear day.</p>
                  }
                  @if (line.eveningBefore.length) {
                    <p class="eyebrow">The evening before</p>
                    <ol>
                      @for (item of line.eveningBefore; track item.id) {
                        <li class="added" data-kind="block">
                          <span class="when">{{ hours(item.start) }}</span>
                          <span class="what">
                            <strong>{{ item.title }}</strong>
                            <em>Added by Headroom</em>
                          </span>
                        </li>
                      }
                    </ol>
                  }
                  <ol>
                    @for (item of line.items; track item.id) {
                      <li [attr.data-kind]="item.kind" [attr.data-tone]="item.tone">
                        <span class="when">{{ hours(item.start) }}</span>
                        @if (item.kind === 'meeting') {
                          <a class="what" [routerLink]="['/', api.user(), 'meetings', item.id]">
                            <strong>{{ item.title }}</strong>
                            <em>{{ durationText(item.minutes) }}@if (item.load !== null) { · load {{ item.load }} }</em>
                          </a>
                        } @else {
                          <span class="what">
                            <strong>{{ item.title }}</strong>
                            <em>
                              {{ durationText(item.minutes) }}
                              @if (item.kind === 'block' || item.movedByHeadroom) {
                                · Added by Headroom
                              }
                            </em>
                          </span>
                        }
                      </li>
                    }
                  </ol>
                </section>
              }
            }
          </article>
        }
      }
    </hr-async>
  `,
})
export class WeekPage {
  protected readonly api = inject(HeadroomApi);
  protected readonly durationText = durationText;
  readonly selected = signal<string | null>(null);

  private readonly zone = computed(() => {
    const briefing = this.api.briefingView();
    return briefing.kind === 'ready' ? briefing.value.user.timeZone : 'Europe/Warsaw';
  });
  private readonly today = computed(() => {
    const view = this.api.weekView();
    return view.kind === 'ready' ? (view.value.days[0]?.date ?? '') : '';
  });
  readonly active = computed(() => {
    const chosen = this.selected();
    const view = this.api.weekView();
    if (view.kind !== 'ready') return chosen;
    if (chosen && view.value.days.some(day => day.date === chosen)) return chosen;
    const heaviest = [...view.value.days].sort((a, b) => b.dayLoad - a.dayLoad)[0];
    return heaviest?.date ?? null;
  });
  readonly day = computed(() => {
    const view = this.api.weekView();
    if (view.kind !== 'ready') return null;
    return view.value.days.find(item => item.date === this.active()) ?? null;
  });
  readonly timeline = computed(() => {
    const day = this.day();
    return day ? dayTimeline(day, this.zone()) : null;
  });
  readonly heading = computed(() => {
    const date = this.active();
    return date ? dayLabel(date, this.today()) : '';
  });
  readonly chart = computed((): EChartsCoreOption => {
    const view = this.api.weekView();
    const days = view.kind === 'ready' ? view.value.days : [];
    const active = this.active();
    return {
      animationDuration: 700,
      grid: { left: 28, right: 8, top: 28, bottom: 32 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: days.map(day => this.chip(day.date)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(16,36,28,0.16)' } },
        axisLabel: { color: '#5c6b64', fontFamily: 'Schibsted Grotesk Variable', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(16,36,28,0.08)' } },
        axisLabel: { color: '#5c6b64', fontFamily: 'IBM Plex Mono', fontSize: 10 },
      },
      series: [
        {
          name: 'Day load',
          type: 'bar',
          barWidth: 18,
          data: days.map(day => ({
            value: day.dayLoad,
            itemStyle: { color: day.date === active ? '#10241c' : '#7dffc3', borderRadius: [8, 8, 0, 0] },
          })),
          markPoint: {
            symbol: 'diamond',
            symbolSize: 12,
            itemStyle: { color: '#10241c' },
            label: { show: true, formatter: '{b}', color: '#10241c', fontFamily: 'IBM Plex Mono', fontSize: 10, position: 'top' },
            data: days.flatMap((day, index) => day.workouts.map(workout => ({ coord: [index, Math.max(day.dayLoad, 8)], name: workout.intensity }))),
          },
        },
        {
          name: 'Capacity',
          type: 'line',
          data: days.map(day => day.capacityForecast),
          showSymbol: false,
          lineStyle: { color: '#12a36a', width: 2 },
        },
      ],
    };
  });

  weekday(date: string): string {
    return shortDate(date).slice(0, 3);
  }

  dayNumber(date: string): string {
    const day = shortDate(date).split(' ')[1] ?? '';
    return day.padStart(2, '0');
  }

  chip(date: string): string {
    const today = this.today();
    if (!today) return shortDate(date);
    if (date === today) return 'Today';
    if (date === this.dayAfter(today)) return 'Tomorrow';
    return shortDate(date).replace(/ \w+$/, '');
  }

  hours(iso: string): string {
    return timeOf(iso, this.zone());
  }

  pick(event: ECElementEvent): void {
    const view = this.api.weekView();
    if (view.kind !== 'ready' || event.dataIndex === undefined) return;
    const day = view.value.days[event.dataIndex];
    if (day) this.selected.set(day.date);
  }

  private dayAfter(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
    return next.toISOString().slice(0, 10);
  }
}
