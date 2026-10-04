import type { UserKey } from '../../../contracts/api-contract';
import type { ConnectorClient, SyncResult } from '../../src/ingest/connector.client';
import type { SampleProbe } from '../../src/ingest/sample-probe';
import type { DelayHandle, Delayer } from '../../src/ingest/timing';
import type { Deferred } from './fakes';
import { deferred } from './fakes';

export class ManualDelayer implements Delayer {
  private queue: { fn: () => void; cancelled: boolean }[] = [];

  delay(_ms: number, fn: () => void): DelayHandle {
    const entry = { fn, cancelled: false };
    this.queue.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  pending(): number {
    return this.queue.filter((entry) => !entry.cancelled).length;
  }

  flush(): void {
    const due = this.queue.splice(0, this.queue.length);
    for (const entry of due) {
      if (!entry.cancelled) entry.fn();
    }
  }
}

export class FakeConnector implements ConnectorClient {
  result: SyncResult = { pushedRecords: 4, latestSampleAt: '2026-10-04T10:58:00+02:00' };
  error: Error | null = null;
  readonly calls: UserKey[] = [];
  gate: Deferred<void> | null = null;

  async sync(userKey: UserKey): Promise<SyncResult> {
    this.calls.push(userKey);
    await this.gate?.promise;
    if (this.error) throw this.error;
    return this.result;
  }
}

export class FakeProbe implements SampleProbe {
  answers: boolean[] = [];
  error: Error | null = null;
  readonly calls: { userKey: UserKey; latestSampleAt: string | null; now: number }[] = [];

  async hasNewerThan(userKey: UserKey, latestSampleAt: string | null, now: number): Promise<boolean> {
    this.calls.push({ userKey, latestSampleAt, now });
    if (this.error) throw this.error;
    return this.answers.shift() ?? false;
  }
}

export { deferred };
