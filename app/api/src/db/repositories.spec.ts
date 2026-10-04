import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlanChange } from '../engine/types';
import { type AppDatabase, openDatabase } from './database';
import {
  AcceptedActionsRepository,
  ReflectionsRepository,
  SnapshotsRepository,
  WebhookDeliveriesRepository,
} from './repositories';

const sleepChange: PlanChange = {
  kind: 'sleep_target',
  bedtime: Date.parse('2026-10-04T20:45:00Z'),
  wake: Date.parse('2026-10-05T04:30:00Z'),
  sleepHours: 7.5,
  forDate: '2026-10-05',
};

describe('repositories', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = openDatabase(':memory:');
  });

  afterEach(() => database.close());

  describe('ReflectionsRepository', () => {
    test('stores one reflection per user and meeting, the latest rating winning', () => {
      const repo = new ReflectionsRepository(database);

      repo.upsert('marta', 'm-1', -1, 1_000);
      repo.upsert('marta', 'm-1', 1, 2_000);
      repo.upsert('marta', 'm-2', 0, 3_000);
      repo.upsert('jakub', 'm-1', -1, 4_000);

      expect(repo.list('marta')).toEqual([
        { meetingId: 'm-1', rating: 1 },
        { meetingId: 'm-2', rating: 0 },
      ]);
      expect(repo.list('jakub')).toEqual([{ meetingId: 'm-1', rating: -1 }]);
    });
  });

  describe('AcceptedActionsRepository', () => {
    test('stores the plan change of an accepted action', () => {
      const repo = new AcceptedActionsRepository(database);

      const stored = repo.accept('marta', 'sleep_target:2026-10-05', sleepChange, 5_000);

      expect(stored).toEqual({ actionId: 'sleep_target:2026-10-05', change: sleepChange, acceptedAt: 5_000, created: true });
      expect(repo.list('marta')).toEqual([{ actionId: 'sleep_target:2026-10-05', change: sleepChange }]);
    });

    test('is idempotent: accepting again keeps the original change and time', () => {
      const repo = new AcceptedActionsRepository(database);
      repo.accept('marta', 'sleep_target:2026-10-05', sleepChange, 5_000);

      const again = repo.accept('marta', 'sleep_target:2026-10-05', { ...sleepChange, sleepHours: 9 }, 9_000);

      expect(again).toEqual({ actionId: 'sleep_target:2026-10-05', change: sleepChange, acceptedAt: 5_000, created: false });
      expect(repo.list('marta')).toHaveLength(1);
    });

    test('keeps users apart and lists in acceptance order', () => {
      const repo = new AcceptedActionsRepository(database);
      const move: PlanChange = { kind: 'move_workout', workoutId: 'w-1', start: 1, end: 2 };
      repo.accept('marta', 'b', move, 2_000);
      repo.accept('marta', 'a', sleepChange, 1_000);
      repo.accept('jakub', 'c', move, 3_000);

      expect(repo.list('marta').map((accepted) => accepted.actionId)).toEqual(['a', 'b']);
      expect(repo.list('jakub').map((accepted) => accepted.actionId)).toEqual(['c']);
    });
  });

  describe('SnapshotsRepository', () => {
    test('returns null before anything is stored', () => {
      expect(new SnapshotsRepository(database).latest('marta')).toBeNull();
    });

    test('keeps only the latest snapshot per user', () => {
      const repo = new SnapshotsRepository(database);

      repo.save('marta', 1_000, { version: 1 });
      repo.save('marta', 2_000, { version: 2 });

      expect(repo.latest('marta')).toEqual({ computedAt: 2_000, payload: { version: 2 } });
      expect(repo.latest('jakub')).toBeNull();
    });
  });

  describe('WebhookDeliveriesRepository', () => {
    test('records a delivery id once and reports repeats', () => {
      const repo = new WebhookDeliveriesRepository(database);

      expect(repo.record('msg_1', 1_000)).toBe(true);
      expect(repo.record('msg_1', 2_000)).toBe(false);
      expect(repo.record('msg_2', 3_000)).toBe(true);
    });
  });
});

describe('openDatabase', () => {
  const dirs: string[] = [];

  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('creates the parent directory and keeps data across reopenings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'headroom-db-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'headroom.sqlite');

    const first = openDatabase(path);
    new ReflectionsRepository(first).upsert('marta', 'm-1', 1, 1_000);
    first.close();
    const second = openDatabase(path);

    expect(existsSync(path)).toBe(true);
    expect(new ReflectionsRepository(second).list('marta')).toEqual([{ meetingId: 'm-1', rating: 1 }]);
    second.close();
  });
});
