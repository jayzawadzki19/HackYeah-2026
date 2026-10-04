import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './schema';

export interface AppDatabase {
  readonly orm: BunSQLiteDatabase;
  close(): void;
}

export const APP_DATABASE = Symbol('AppDatabase');

/** Opens (creating if needed) the SQLite file and applies the idempotent schema. */
export const openDatabase = (path: string): AppDatabase => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  client.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') client.exec('PRAGMA journal_mode = WAL;');
  client.exec(SCHEMA_SQL);
  return { orm: drizzle({ client }), close: () => client.close() };
};
