import type { EventSourceLike } from './event-source';
import { mockHub } from '../../../testing/mock-hub';

/** In-memory stand-in for `/api/users/:key/stream` while `environment.mockApi` is on. */
export class MockEventSource implements EventSourceLike {
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();
  private readonly unregister: () => void;
  private closed = false;

  constructor(readonly url: string) {
    this.unregister = mockHub.register({ url, emit: (type, data) => this.dispatch(type, data) });
    queueMicrotask(() => {
      if (!this.closed) this.dispatch('open');
    });
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.unregister();
  }

  private dispatch(type: string, data?: string): void {
    if (this.closed) return;
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
