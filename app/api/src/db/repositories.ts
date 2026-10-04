import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Rating, UserKey } from '../../../contracts/api-contract';
import type { AcceptedChange, PlanChange, Reflection } from '../engine/types';
import { APP_DATABASE, type AppDatabase } from './database';
import { planChangeSchema } from './plan-change.schema';
import { acceptedActions, forecastSnapshots, reflections, webhookDeliveries } from './schema';

@Injectable()
export class ReflectionsRepository {
  constructor(@Inject(APP_DATABASE) private readonly database: AppDatabase) {}

  upsert(userKey: UserKey, meetingId: string, rating: Rating, at: number): void {
    this.database.orm
      .insert(reflections)
      .values({ userKey, meetingId, rating, createdAt: at })
      .onConflictDoUpdate({ target: [reflections.userKey, reflections.meetingId], set: { rating, createdAt: at } })
      .run();
  }

  list(userKey: UserKey): readonly Reflection[] {
    return this.database.orm
      .select({ meetingId: reflections.meetingId, rating: reflections.rating })
      .from(reflections)
      .where(eq(reflections.userKey, userKey))
      .orderBy(asc(reflections.id))
      .all();
  }
}

export interface StoredAcceptance {
  readonly actionId: string;
  readonly change: PlanChange;
  readonly acceptedAt: number;
  /** false when the action had already been accepted (the original change is kept) */
  readonly created: boolean;
}

const decodeChange = (json: string): PlanChange => planChangeSchema.parse(JSON.parse(json));

@Injectable()
export class AcceptedActionsRepository {
  constructor(@Inject(APP_DATABASE) private readonly database: AppDatabase) {}

  accept(userKey: UserKey, actionId: string, change: PlanChange, at: number): StoredAcceptance {
    const inserted = this.database.orm
      .insert(acceptedActions)
      .values({ userKey, actionId, changeJson: JSON.stringify(change), acceptedAt: at })
      .onConflictDoNothing()
      .returning()
      .all();
    const [row] = this.database.orm
      .select()
      .from(acceptedActions)
      .where(and(eq(acceptedActions.userKey, userKey), eq(acceptedActions.actionId, actionId)))
      .all();
    if (row === undefined) throw new Error(`Accepted action ${actionId} vanished after insert`);
    return { actionId, change: decodeChange(row.changeJson), acceptedAt: row.acceptedAt, created: inserted.length > 0 };
  }

  list(userKey: UserKey): readonly AcceptedChange[] {
    return this.database.orm
      .select()
      .from(acceptedActions)
      .where(eq(acceptedActions.userKey, userKey))
      .orderBy(asc(acceptedActions.acceptedAt), asc(acceptedActions.id))
      .all()
      .map((row) => ({ actionId: row.actionId, change: decodeChange(row.changeJson) }));
  }
}

export interface StoredSnapshot {
  readonly computedAt: number;
  readonly payload: unknown;
}

@Injectable()
export class SnapshotsRepository {
  constructor(@Inject(APP_DATABASE) private readonly database: AppDatabase) {}

  save(userKey: UserKey, computedAt: number, payload: unknown): void {
    const payloadJson = JSON.stringify(payload);
    this.database.orm
      .insert(forecastSnapshots)
      .values({ userKey, computedAt, payloadJson })
      .onConflictDoUpdate({ target: forecastSnapshots.userKey, set: { computedAt, payloadJson } })
      .run();
  }

  latest(userKey: UserKey): StoredSnapshot | null {
    const [row] = this.database.orm.select().from(forecastSnapshots).where(eq(forecastSnapshots.userKey, userKey)).all();
    if (row === undefined) return null;
    const payload: unknown = JSON.parse(row.payloadJson);
    return { computedAt: row.computedAt, payload };
  }
}

@Injectable()
export class WebhookDeliveriesRepository {
  constructor(@Inject(APP_DATABASE) private readonly database: AppDatabase) {}

  /** Returns true the first time a delivery id is seen, false for repeats. */
  record(svixId: string, at: number): boolean {
    return (
      this.database.orm
        .insert(webhookDeliveries)
        .values({ svixId, receivedAt: at })
        .onConflictDoNothing()
        .returning()
        .all().length > 0
    );
  }
}
