import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Rating, UserKey } from '../../../contracts/api-contract';

export const reflections = sqliteTable(
  'reflections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userKey: text('user_key').$type<UserKey>().notNull(),
    meetingId: text('meeting_id').notNull(),
    rating: integer('rating').$type<Rating>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('reflections_user_meeting').on(table.userKey, table.meetingId)],
);

export const acceptedActions = sqliteTable(
  'accepted_actions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userKey: text('user_key').$type<UserKey>().notNull(),
    actionId: text('action_id').notNull(),
    changeJson: text('change_json').notNull(),
    acceptedAt: integer('accepted_at').notNull(),
  },
  (table) => [uniqueIndex('accepted_actions_user_action').on(table.userKey, table.actionId)],
);

export const forecastSnapshots = sqliteTable('forecast_snapshots', {
  userKey: text('user_key').$type<UserKey>().primaryKey(),
  computedAt: integer('computed_at').notNull(),
  payloadJson: text('payload_json').notNull(),
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  svixId: text('svix_id').primaryKey(),
  receivedAt: integer('received_at').notNull(),
});

/** Idempotent DDL matching the Drizzle tables above; run on every boot. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 0, 1)),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reflections_user_meeting ON reflections (user_key, meeting_id);
CREATE TABLE IF NOT EXISTS accepted_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL,
  action_id TEXT NOT NULL,
  change_json TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accepted_actions_user_action ON accepted_actions (user_key, action_id);
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  user_key TEXT PRIMARY KEY,
  computed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  svix_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
`;
