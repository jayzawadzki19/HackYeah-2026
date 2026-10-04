import { Injectable } from '@nestjs/common';
import type { UserKey } from '../../../contracts/api-contract';

/** When data last reached us per user: a successful Sync now or a verified webhook. */
@Injectable()
export class SyncStatus {
  private readonly lastSync = new Map<UserKey, number>();

  markSynced(userKey: UserKey, at: number): void {
    this.lastSync.set(userKey, Math.max(at, this.lastSync.get(userKey) ?? at));
  }

  lastSyncAt(userKey: UserKey): number | null {
    return this.lastSync.get(userKey) ?? null;
  }
}
