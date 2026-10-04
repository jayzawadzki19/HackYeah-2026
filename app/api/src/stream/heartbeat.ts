import { interval, map, type Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

export const HEARTBEAT_EVERY_MS = Symbol('HeartbeatEveryMs');
export const HEARTBEAT_SOURCE = Symbol('HeartbeatSource');

export const DEFAULT_HEARTBEAT_MS = 15_000;

export type HeartbeatSource = (everyMs: number) => Observable<MessageEvent>;

/** Comment line every 15s so proxies keep the stream open. */
export const intervalHeartbeat: HeartbeatSource = (everyMs) => interval(everyMs).pipe(map(() => ({ comment: 'ping' })));
