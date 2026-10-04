import { ChangeDetectionStrategy, Component, computed, effect, inject, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { HeadroomApi } from '../../core/api/headroom-api';
import { meetingTypeLabel, pastTypeHeading } from '../../domain/load';
import { shortDate, timeOf } from '../../domain/time';
import { AsyncState } from '../../ui/async-state';

@Component({
  selector: 'hr-meeting-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AsyncState, NgxEchartsDirective, RouterLink],
  template: `
    <hr-async [state]="api.meetingView()">
      @if (api.meetingView(); as view) {
        @if (view.kind === 'ready') {
          <article class="page meeting">
            <p class="eyebrow">{{ kindLabel() }}</p>
            <header class="lede">
              <h1>{{ view.value.meeting.title }}</h1>
              <p class="sentence">{{ when() }}</p>
            </header>
            @if (view.value.predicted; as predicted) {
              <section class="predict">
                <p class="score">{{ predicted.predictedLoad }}</p>
                <p>{{ predicted.basis.label }}</p>
                @if (predicted.modifiers.backToBack) {
                  <p class="fine">Back to back</p>
                }
                @if (predicted.modifiers.lateStart) {
                  <p class="fine">Starts at or after 16:00</p>
                }
              </section>
            }
            @if (view.value.insufficientReason; as reason) {
              <p class="empty">{{ reason }}</p>
            }
            @if (view.value.measured; as measured) {
              <ul class="stats">
                <li><span>Measured load</span><strong>{{ measured.load }}</strong></li>
                <li><span>Excess stress</span><strong>+{{ measured.excessStress }}</strong></li>
                <li><span>Recovery tail</span><strong>{{ measured.recoveryTailMin }} min</strong></li>
              </ul>
            }
            @if (view.value.trace.length) {
              <div class="chart tall" echarts [options]="chart()"></div>
            }
            <section class="measure">
              <h2>How we measure</h2>
              <p>{{ view.value.howWeMeasure }}</p>
            </section>
            @if (view.value.pastSameType.length) {
              <section>
                <h2>{{ pastHeading() }}</h2>
                <ol class="agenda">
                  @for (past of view.value.pastSameType; track past.id) {
                    <li>
                      <a [routerLink]="['/', api.user(), 'meetings', past.id]">
                        <span class="when">{{ dateOf(past.start) }}</span>
                        <span class="what"><strong>{{ past.title }}</strong></span>
                        <span class="load">{{ past.measuredLoad ?? 'no data' }}</span>
                      </a>
                    </li>
                  }
                </ol>
              </section>
            }
          </article>
        }
      }
    </hr-async>
  `,
})
export class MeetingPage {
  protected readonly api = inject(HeadroomApi);
  private readonly route = inject(ActivatedRoute);
  private readonly id = toSignal(this.route.paramMap.pipe(map(params => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  readonly chart = computed((): EChartsCoreOption => {
    const view = this.api.meetingView();
    const detail = view.kind === 'ready' ? view.value : null;
    const trace = detail?.trace ?? [];
    const meeting = detail?.meeting;
    const recovered = detail?.measured?.recoveredAt;
    const band = trace.map(point => [point.t, (point.baselineStress ?? 0) - 4]);
    const thickness = trace.map(point => [point.t, 8]);
    return {
      animationDuration: 700,
      grid: { left: 36, right: 12, top: 24, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'time',
        axisLabel: { color: '#5e564c', fontFamily: 'IBM Plex Mono', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(27,23,20,0.18)' } },
      },
      yAxis: {
        type: 'value',
        name: 'Stress',
        splitLine: { lineStyle: { color: 'rgba(27,23,20,0.08)' } },
        axisLabel: { color: '#5e564c', fontFamily: 'IBM Plex Mono', fontSize: 10 },
      },
      series: [
        { type: 'line', stack: 'band', data: band, symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true },
        {
          type: 'line',
          stack: 'band',
          data: thickness,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(27, 23, 20, 0.08)' },
          silent: true,
        },
        {
          name: 'Stress',
          type: 'line',
          data: trace.map(point => [point.t, point.stress]),
          showSymbol: false,
          lineStyle: { color: '#8d2e2b', width: 2 },
          markArea: meeting
            ? {
                silent: true,
                data: [
                  [{ xAxis: meeting.start, itemStyle: { color: 'rgba(141, 46, 43, 0.14)' } }, { xAxis: meeting.end }],
                  ...(recovered ? [[{ xAxis: meeting.end, itemStyle: { color: 'rgba(138, 70, 48, 0.16)' } }, { xAxis: recovered }]] : []),
                ],
              }
            : undefined,
        },
      ],
    };
  });

  constructor() {
    effect(() => this.api.meetingId.set(this.id()));
  }

  when(): string {
    const view = this.api.meetingView();
    if (view.kind !== 'ready') return '';
    const zone = this.zone();
    const meeting = view.value.meeting;
    return `${shortDate(meeting.start.slice(0, 10))} ${timeOf(meeting.start, zone)}-${timeOf(meeting.end, zone)}`;
  }

  dateOf(iso: string): string {
    return `${shortDate(iso.slice(0, 10))} ${timeOf(iso, this.zone())}`;
  }

  pastHeading(): string {
    const view = this.api.meetingView();
    return view.kind === 'ready' ? pastTypeHeading(view.value.meeting.type) : '';
  }

  kindLabel(): string {
    const view = this.api.meetingView();
    return view.kind === 'ready' ? meetingTypeLabel(view.value.meeting.type) : '';
  }

  private zone(): string {
    const briefing = this.api.briefingView();
    return briefing.kind === 'ready' ? briefing.value.user.timeZone : 'Europe/Warsaw';
  }
}
