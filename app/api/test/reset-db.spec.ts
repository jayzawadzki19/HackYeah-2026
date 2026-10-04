import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePathFrom, resetDatabase } from '../scripts/reset-db';

describe('reset-db', () => {
  const dirs: string[] = [];

  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('deletes the database together with its WAL and shared-memory files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'headroom-reset-'));
    dirs.push(dir);
    const path = join(dir, 'headroom.sqlite');
    [path, `${path}-wal`, `${path}-shm`].forEach((file) => writeFileSync(file, ''));

    const removed = resetDatabase(path);

    expect(removed).toEqual([path, `${path}-wal`, `${path}-shm`]);
    expect([path, `${path}-wal`, `${path}-shm`].some((file) => existsSync(file))).toBe(false);
  });

  test('reports nothing when there is no database yet', () => {
    expect(resetDatabase(join(tmpdir(), 'headroom-missing', 'headroom.sqlite'))).toEqual([]);
  });

  test('resolves DB_PATH against the api root and defaults to data/local/headroom.sqlite', () => {
    expect(databasePathFrom({}, '/srv/api')).toBe('/srv/api/data/local/headroom.sqlite');
    expect(databasePathFrom({ DB_PATH: 'tmp/demo.sqlite' }, '/srv/api')).toBe('/srv/api/tmp/demo.sqlite');
  });
});
