import { ChangeDetectionStrategy, Component, computed, inject, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { UserKey } from '@contracts';
import { HeadroomApi } from '../core/api/headroom-api';
import { LiveStreamService } from '../core/live/live-stream.service';
import { Clock } from '../core/ui/clock';
import { Toasts } from '../core/ui/toasts';
import { relativeAgo } from '../domain/time';

@Component({
  selector: 'hr-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app">
      <aside class="dock">
        <p class="wordmark">Headroom</p>
        <p class="tagline">A calendar-aware recovery forecast.</p>
        <nav class="tabs" aria-label="Sections">
          <a routerLink="briefing" routerLinkActive="is-active">Briefing</a>
          <a routerLink="week" routerLinkActive="is-active">Week</a>
          <a routerLink="energy-map" routerLinkActive="is-active">Energy</a>
          <a routerLink="check-in" routerLinkActive="is-active">Check-in</a>
        </nav>
      </aside>
      <div class="stage">
        <header class="mast">
          <p class="wordmark stage-mark">Headroom</p>
          <nav class="accounts" aria-label="Account">
            <a [routerLink]="['/', 'jakub', section()]" [attr.aria-current]="user() === 'jakub' ? 'page' : null">Jakub - live</a>
            <a [routerLink]="['/', 'marta', section()]" [attr.aria-current]="user() === 'marta' ? 'page' : null">Marta - demo persona</a>
          </nav>
        </header>
        @if (persona()?.isSynthetic) {
          <p class="banner">Demo persona - synthetic data</p>
        }
        @if (persona()?.live) {
          <p class="live-line">
            <span class="pulse" aria-hidden="true"></span>
            Live - Garmin via open-wearables
            @if (syncLabel(); as ago) {
              <span class="sync">Last sync: {{ ago }}</span>
            }
          </p>
        }
        @if (known()) {
          <main>
            <router-outlet />
          </main>
        } @else {
          <p class="state-error" role="alert">Unknown account.</p>
        }
      </div>
      <div class="toasts" aria-live="polite">
        @for (toast of toasts.items(); track toast.id) {
          <p class="toast">{{ toast.text }}</p>
        }
      </div>
    </div>
  `,
})
export class Shell {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(HeadroomApi);
  private readonly stream = inject(LiveStreamService);
  private readonly clock = inject(Clock);
  protected readonly toasts = inject(Toasts);

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly url = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly user = computed(() => this.api.user());
  readonly known = computed(() => {
    const key = this.params().get('user');
    return key === 'jakub' || key === 'marta';
  });
  readonly section = computed(() => {
    const page = (this.url() ?? '').split('?')[0]?.split('/').filter(Boolean)[1];
    if (page === 'week' || page === 'energy-map' || page === 'check-in') return page;
    return 'briefing';
  });
  readonly persona = computed(() => {
    const briefing = this.api.briefingView();
    if (briefing.kind === 'ready') return briefing.value.user;
    const users = this.api.usersView();
    if (users.kind !== 'ready') return null;
    return users.value.find(item => item.key === this.api.user()) ?? null;
  });
  readonly syncLabel = computed(() => {
    const briefing = this.api.briefingView();
    if (briefing.kind !== 'ready') return null;
    return relativeAgo(briefing.value.live?.lastSyncAt ?? null, this.clock.now());
  });

  constructor() {
    effect(() => {
      const key = this.params().get('user');
      if (key === 'jakub' || key === 'marta') {
        this.api.user.set(key);
        this.stream.connect(key as UserKey);
      }
    });
    this.stream.events$.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'sync.status' && event.state === 'ok' && typeof event.pushedRecords === 'number') {
        this.toasts.push(`${event.pushedRecords} new samples`);
      }
      if (event.type === 'sync.status' && event.state === 'error' && event.error) this.toasts.push(event.error);
    });
  }
}
