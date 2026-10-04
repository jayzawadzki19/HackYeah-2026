import { InjectionToken } from '@angular/core';

export interface EventSourceLike {
  readonly url: string;
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export const EVENT_SOURCE_FACTORY = new InjectionToken<(url: string) => EventSourceLike>('EVENT_SOURCE_FACTORY');
