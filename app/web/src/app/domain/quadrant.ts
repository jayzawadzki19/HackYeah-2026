import type { EnergyGroup } from '@contracts';

/** Architecture 7.7 group thresholds */
export const BODY_DRAIN_MIN = 4;
export const FELT_DRAINED_MAX = -0.25;
export const ENERGIZER_BODY_MAX = -3;
export const ENERGIZER_FELT_MIN = 0.25;

/** Body effects beyond +/- this many load points sit on the plot edge */
const BODY_RANGE = 20;
/** Keeps dots (and their labels) off the plot border, in percent */
const EDGE_PAD = 6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A person without check-ins counts as neither drained nor energized */
const feltOrNeutral = (felt: number | null): number => felt ?? 0;

export const regionOf = (bodyEffect: number, felt: number | null): EnergyGroup => {
  const f = feltOrNeutral(felt);
  if (bodyEffect >= BODY_DRAIN_MIN) return f <= FELT_DRAINED_MAX ? 'known_drain' : 'hidden_drain';
  if (f <= FELT_DRAINED_MAX) return 'overestimated';
  return bodyEffect <= ENERGIZER_BODY_MAX || f >= ENERGIZER_FELT_MIN ? 'energizer' : 'neutral';
};

/**
 * Piecewise-linear scale whose midpoint is the threshold, so the quadrant crossing sits in the
 * visual centre and every quadrant matches its group rule.
 */
const piecewise = (value: number, min: number, threshold: number, max: number): number => {
  const v = clamp(value, min, max);
  return v <= threshold ? (50 * (v - min)) / (threshold - min) : 50 + (50 * (v - threshold)) / (max - threshold);
};

const padded = (percent: number): number => EDGE_PAD + ((100 - 2 * EDGE_PAD) * percent) / 100;

const xOf = (bodyEffect: number): number => padded(piecewise(bodyEffect, -BODY_RANGE, BODY_DRAIN_MIN, BODY_RANGE));
const yOf = (felt: number): number => padded(piecewise(felt, -1, FELT_DRAINED_MAX, 1));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Position in percent: x from the left (body drains to the right), y from the bottom (felt better upward). */
export const plotPosition = (bodyEffect: number, felt: number | null): { readonly x: number; readonly y: number } => ({
  x: round2(xOf(bodyEffect)),
  y: round2(yOf(feltOrNeutral(felt))),
});

/** The small neutral box next to the crossing (energizer quadrant minus the energizer rule), in plot percent */
export const NEUTRAL_ZONE = {
  left: round2(xOf(ENERGIZER_BODY_MAX)),
  width: round2(xOf(BODY_DRAIN_MIN) - xOf(ENERGIZER_BODY_MAX)),
  bottom: round2(yOf(FELT_DRAINED_MAX)),
  height: round2(yOf(ENERGIZER_FELT_MIN) - yOf(FELT_DRAINED_MAX)),
} as const;
