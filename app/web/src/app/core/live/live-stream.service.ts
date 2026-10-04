import { Injectable, inject, signal } from '@angular/core';
import type { StreamEventDto, UserKey } from '@contracts';
import { Subject } from 'rxjs';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from './event-source';
import { parseStreamEvent, reconnectDelay } from './stream-event';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting';

type SyncStatus = Extract<StreamEventDto, { type: 'sync.status' }>;

@Injectable({ providedIn: 'root' })
export class LiveStreamService {
  private readonly openSource = inject(EVENT_SOURCE_FACTORY);
  private source: EventSourceLike | null = null;
  private user: UserKey | null = null;
  private attempt = 0;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly connection = signal<ConnectionState>('idle');
  readonly sync = signal<SyncStatus | null>(null);

  private readonly refreshSubject = new Subject<void>();
  readonly refresh$ = this.refreshSubject.asObservable();

  private readonly eventsSubject = new Subject<StreamEventDto>();
  readonly events$ = this.eventsSubject.asObservable();

  connect(user: UserKey): void {
    if (this.user === user && this.connection() !== 'idle') return;
    this.stop();
    this.user = user;
    this.attempt = 0;
    this.sync.set(null);
    this.connection.set('connecting');
    this.attach(user, this.generation, false);
  }

  disconnect(): void {
    this.stop();
    this.user = null;
    this.sync.set(null);
    this.connection.set('idle');
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.source?.close();
    this.source = null;
    this.generation += 1;
  }

  private attach(user: UserKey, generation: number, isReconnect: boolean): void {
    const source = this.openSource(`/api/users/${user}/stream`);
    this.source = source;

    source.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.connection.set('open');
      this.attempt = 0;
      if (isReconnect) this.refreshSubject.next();
    });

    source.addEventListener('error', () => {
      if (generation !== this.generation) return;
      source.close();
      this.connection.set('reconnecting');
      const delay = reconnectDelay(this.attempt);
      this.attempt += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (generation !== this.generation) return;
        this.attach(user, generation, true);
      }, delay);
    });

    const onMessage = (event: Event): void => {
      if (generation !== this.generation || !(event instanceof MessageEvent)) return;
      const parsed = parseStreamEvent(String(event.data));
      if (!parsed) return;
      this.eventsSubject.next(parsed);
      if (parsed.type === 'sync.status') this.sync.set(parsed);
      if (parsed.type === 'forecast.updated') this.refreshSubject.next();
    };

    source.addEventListener('sync.status', onMessage);
    source.addEventListener('forecast.updated', onMessage);
    source.addEventListener('message', onMessage);
  }
}
