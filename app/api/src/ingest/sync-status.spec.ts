import { describe, expect, test } from 'bun:test';
import { SyncStatus } from './sync-status';

describe('SyncStatus', () => {
  test('is null until a sync is recorded', () => {
    expect(new SyncStatus().lastSyncAt('jakub')).toBeNull();
  });

  test('keeps the most recent time per user, ignoring out-of-order reports', () => {
    const status = new SyncStatus();

    status.markSynced('jakub', 2_000);
    status.markSynced('jakub', 1_000);
    status.markSynced('marta', 500);

    expect(status.lastSyncAt('jakub')).toBe(2_000);
    expect(status.lastSyncAt('marta')).toBe(500);
  });
});
