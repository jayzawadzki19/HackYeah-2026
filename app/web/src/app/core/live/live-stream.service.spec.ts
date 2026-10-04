import { TestBed } from '@angular/core/testing';
import type { StreamEventDto } from '@contracts';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from './event-source';
import { LiveStreamService } from './live-stream.service';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: string): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    (this.listeners.get(type) ?? []).forEach(listener => listener(event));
  }
}

const latest = (): FakeEventSource => {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error('no event source was opened');
  return source;
};

describe('LiveStreamService', () => {
  let service: LiveStreamService;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    TestBed.configureTestingModule({
      providers: [{ provide: EVENT_SOURCE_FACTORY, useValue: (url: string) => new FakeEventSource(url) }],
    });
    service = TestBed.inject(LiveStreamService);
  });

  afterEach(() => {
    service.disconnect();
    vi.useRealTimers();
  });

  it('opens one stream for the user', () => {
    service.connect('jakub');

    expect(FakeEventSource.instances.map(s => s.url)).toEqual(['/api/users/jakub/stream']);
    expect(service.connection()).toBe('connecting');

    latest().emit('open');
    expect(service.connection()).toBe('open');
  });

  it('does not open a second stream for the same user', () => {
    service.connect('jakub');
    service.connect('jakub');

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reconnects with exponential backoff after errors', () => {
    service.connect('jakub');
    const first = latest();

    first.emit('error');
    expect(first.closed).toBe(true);
    expect(service.connection()).toBe('reconnecting');

    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    latest().emit('error');
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    latest().emit('error');
    vi.advanceTimersByTime(4000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('resets the backoff once a reconnect succeeds', () => {
    service.connect('jakub');
    latest().emit('error');
    vi.advanceTimersByTime(1000);
    latest().emit('open');

    latest().emit('error');
    vi.advanceTimersByTime(1000);

    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('asks for a refresh after a reconnect, because events may have been missed', () => {
    const refreshes = vi.fn();
    const subscription = service.refresh$.subscribe(refreshes);
    service.connect('jakub');

    latest().emit('open');
    expect(refreshes).not.toHaveBeenCalled();

    latest().emit('error');
    vi.advanceTimersByTime(1000);
    latest().emit('open');
    expect(refreshes).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('asks for a refresh when the forecast was recomputed', () => {
    const refreshes = vi.fn();
    const subscription = service.refresh$.subscribe(refreshes);
    service.connect('marta');

    latest().emit('forecast.updated', JSON.stringify({ type: 'forecast.updated', computedAt: '2026-10-04T18:00:00Z' }));

    expect(refreshes).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('exposes the latest sync status and every event', () => {
    const events: StreamEventDto[] = [];
    const subscription = service.events$.subscribe(event => events.push(event));
    service.connect('jakub');

    latest().emit('sync.status', JSON.stringify({ type: 'sync.status', state: 'running', at: '2026-10-04T10:00:00Z' }));
    expect(service.sync()?.state).toBe('running');

    latest().emit('sync.status', JSON.stringify({ type: 'sync.status', state: 'ok', pushedRecords: 46, at: '2026-10-04T10:00:03Z' }));
    expect(service.sync()).toMatchObject({ state: 'ok', pushedRecords: 46 });
    expect(events.map(e => e.type)).toEqual(['sync.status', 'sync.status']);
    subscription.unsubscribe();
  });

  it('accepts events sent without an event name', () => {
    service.connect('jakub');

    latest().emit('message', JSON.stringify({ type: 'sync.status', state: 'error', error: 'Garmin is slow', at: '2026-10-04T10:00:00Z' }));

    expect(service.sync()).toMatchObject({ state: 'error', error: 'Garmin is slow' });
  });

  it('ignores malformed messages', () => {
    service.connect('jakub');

    latest().emit('sync.status', '{oops');

    expect(service.sync()).toBeNull();
  });

  it('closes the old stream and cancels its pending reconnect when the user changes', () => {
    service.connect('jakub');
    const jakub = latest();
    jakub.emit('error');

    service.connect('marta');
    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.instances.map(s => s.url)).toEqual(['/api/users/jakub/stream', '/api/users/marta/stream']);
    expect(service.sync()).toBeNull();
  });

  it('stops reconnecting after disconnect', () => {
    service.connect('jakub');
    latest().emit('error');

    service.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(service.connection()).toBe('idle');
  });

  it('ignores events from a stream it already closed', () => {
    service.connect('jakub');
    const jakub = latest();
    service.connect('marta');

    jakub.emit('sync.status', JSON.stringify({ type: 'sync.status', state: 'running', at: '2026-10-04T10:00:00Z' }));
    jakub.emit('error');
    vi.advanceTimersByTime(60_000);

    expect(service.sync()).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
