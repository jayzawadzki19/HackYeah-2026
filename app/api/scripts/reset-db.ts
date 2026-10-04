import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvironment } from '../src/config/env-file';
import { DEFAULT_DB_PATH, resolvePath } from '../src/config/env';

/** Deletes the SQLite file and its WAL/shared-memory companions; returns the files that existed. */
export const resetDatabase = (path: string): readonly string[] =>
  [path, `${path}-wal`, `${path}-shm`]
    .filter((file) => existsSync(file))
    .map((file) => {
      rmSync(file);
      return file;
    });

export const databasePathFrom = (env: Readonly<Record<string, string | undefined>>, apiRoot: string): string =>
  resolvePath(apiRoot, env.DB_PATH ?? DEFAULT_DB_PATH);

if (import.meta.main) {
  const apiRoot = resolve(import.meta.dir, '..');
  const path = databasePathFrom(loadEnvironment(join(apiRoot, '.env.local'), process.env), apiRoot);
  const removed = resetDatabase(path);
  console.log(
    removed.length === 0
      ? `No database at ${path}; nothing to reset.`
      : `Deleted ${removed.join(', ')}. Restart the api to begin a clean demo.`,
  );
}
