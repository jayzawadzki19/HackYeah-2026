import { z } from 'zod';
import type { PlanChange } from '../engine/types';

const epochMs = z.number().int();
const isoDate = z.iso.date();

export const planChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sleep_target'), bedtime: epochMs, wake: epochMs, sleepHours: z.number(), forDate: isoDate }),
  z.object({ kind: z.literal('move_workout'), workoutId: z.string(), start: epochMs, end: epochMs }),
  z.object({ kind: z.literal('add_block'), title: z.string(), start: epochMs, end: epochMs, forDate: isoDate }),
]) satisfies z.ZodType<PlanChange>;
