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
    <div class="canvas">
      <div class="app">
        <header class="mast">
          <div class="who">
            <span class="avatar" aria-hidden="true">{{ initial() }}</span>
            <div>
              <p class="kicker">Welcome back</p>
              <p class="who-name">{{ greetingName() }}</p>
            </div>
          </div>
          <nav class="accounts" aria-label="Account">
            <a [routerLink]="['/', 'jakub', section()]" [attr.aria-current]="user() === 'jakub' ? 'page' : null">Jakub</a>
            <a [routerLink]="['/', 'marta', section()]" [attr.aria-current]="user() === 'marta' ? 'page' : null">Marta</a>
          </nav>
        </header>
        @if (persona()?.isSynthetic) {
          <p class="banner">Demo persona - synthetic data</p>
        }
        @if (persona()?.live) {
          <p class="live-line">
            <span class="pulse" aria-hidden="true"></span>
            Live
            @if (syncLabel(); as ago) {
              <span class="sync">Synced {{ ago }}</span>
            }
          </p>
        }
        <div class="stage">
          @if (known()) {
            <main>
              <router-outlet />
            </main>
          } @else {
            <p class="state-error" role="alert">Unknown account.</p>
          }
        </div>
        <nav class="dock" aria-label="Sections">
          <a routerLink="briefing" routerLinkActive="is-active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>
            <span>Brief</span>
          </a>
          <a routerLink="week" routerLinkActive="is-active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 8h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>
            <span>Week</span>
          </a>
          <a routerLink="energy-map" routerLinkActive="is-active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-7-10a7 7 0 0 1 12.2-4.7A7 7 0 0 1 19 11c0 5.6-7 10-7 10z"/></svg>
            <span>Energy</span>
          </a>
          <a routerLink="check-in" routerLinkActive="is-active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 1 8 0c0 3-4 5-4 5s-4-2-4-5zM5 20c1.2-2 3.2-3 7-3s5.8 1 7 3"/></svg>
            <span>Check-in</span>
          </a>
        </nav>
        <div class="toasts" aria-live="polite">
          @for (toast of toasts.items(); track toast.id) {
            <p class="toast">{{ toast.text }}</p>
          }
        </div>
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
  readonly greetingName = computed(() => this.persona()?.displayName ?? (this.user() === 'marta' ? 'Marta' : 'Jakub'));
  readonly initial = computed(() => this.greetingName().charAt(0).toUpperCase());
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
