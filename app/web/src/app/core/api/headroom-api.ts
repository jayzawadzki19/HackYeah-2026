import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  AcceptActionResultDto,
  BriefingDto,
  EnergyMapDto,
  MeetingDetailDto,
  PendingCheckInDto,
  Rating,
  ReflectionResultDto,
  SyncAcceptedDto,
  UserKey,
  UserSummaryDto,
  WeekDto,
} from '@contracts';
import { tap } from 'rxjs';
import { applyAccepted, mergeEnergyEntries } from '../../domain/briefing';
import { LiveStreamService } from '../live/live-stream.service';
import { remembered } from '../state/remember';

@Injectable({ providedIn: 'root' })
export class HeadroomApi {
  private readonly http = inject(HttpClient);
  private readonly stream = inject(LiveStreamService);

  readonly user = signal<UserKey>('jakub');
  readonly meetingId = signal<string | null>(null);

  readonly users = httpResource<readonly UserSummaryDto[]>(() => '/api/users');
  readonly briefing = httpResource<BriefingDto>(() => `/api/users/${this.user()}/briefing`);
  readonly week = httpResource<WeekDto>(() => `/api/users/${this.user()}/week`);
  readonly energyMap = httpResource<EnergyMapDto>(() => `/api/users/${this.user()}/energy-map`);
  readonly pending = httpResource<readonly PendingCheckInDto[]>(() => `/api/users/${this.user()}/check-ins/pending`);
  readonly meeting = httpResource<MeetingDetailDto>(() => {
    const id = this.meetingId();
    return id ? `/api/users/${this.user()}/meetings/${encodeURIComponent(id)}` : undefined;
  });

  readonly usersView = remembered(this.users);
  readonly briefingView = remembered(this.briefing);
  readonly weekView = remembered(this.week);
  readonly energyView = remembered(this.energyMap);
  readonly pendingView = remembered(this.pending);
  readonly meetingView = remembered(this.meeting);

  constructor() {
    this.stream.refresh$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.briefing.reload();
      this.week.reload();
      this.energyMap.reload();
      this.pending.reload();
      if (this.meetingId()) this.meeting.reload();
    });
  }

  accept(actionId: string) {
    return this.http.post<AcceptActionResultDto>(`/api/users/${this.user()}/actions/${encodeURIComponent(actionId)}/accept`, {}).pipe(
      tap(result => {
        if (this.briefing.hasValue() && this.briefing.value()) {
          this.briefing.update(current => (current ? applyAccepted(current, result) : current));
        }
        this.week.reload();
      }),
    );
  }

  reflect(meetingId: string, rating: Rating) {
    return this.http
      .post<ReflectionResultDto>(`/api/users/${this.user()}/meetings/${encodeURIComponent(meetingId)}/reflection`, { rating })
      .pipe(
        tap(result => {
          if (this.energyMap.hasValue() && this.energyMap.value()) {
            this.energyMap.update(current => (current ? mergeEnergyEntries(current, result.updated) : current));
          }
          this.pending.reload();
        }),
      );
  }

  syncNow() {
    return this.http.post<SyncAcceptedDto>(`/api/users/${this.user()}/sync-now`, {});
  }
}
