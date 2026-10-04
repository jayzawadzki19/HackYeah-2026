import type { StreamEventDto } from '@contracts';

const CAP_MS = 30_000;

export const reconnectDelay = (attempt: number): number => Math.min(1_000 * 2 ** attempt, CAP_MS);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isSyncState = (value: unknown): value is 'running' | 'ok' | 'error' => value === 'running' || value === 'ok' || value === 'error';

export const parseStreamEvent = (data: string): StreamEventDto | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (parsed['type'] === 'sync.status') {
    if (!isSyncState(parsed['state']) || typeof parsed['at'] !== 'string') return null;
    const event: {
      type: 'sync.status';
      state: 'running' | 'ok' | 'error';
      at: string;
      pushedRecords?: number;
      latestSampleAt?: string | null;
      error?: string;
    } = { type: 'sync.status', state: parsed['state'], at: parsed['at'] };
    if (typeof parsed['pushedRecords'] === 'number') event.pushedRecords = parsed['pushedRecords'];
    if (typeof parsed['error'] === 'string') event.error = parsed['error'];
    if (parsed['latestSampleAt'] === null || typeof parsed['latestSampleAt'] === 'string') event.latestSampleAt = parsed['latestSampleAt'];
    return event;
  }

  if (parsed['type'] === 'forecast.updated' && typeof parsed['computedAt'] === 'string') {
    return { type: 'forecast.updated', computedAt: parsed['computedAt'] };
  }

  return null;
};
