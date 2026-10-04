export interface Clock {
  now(): number;
}

export const CLOCK = Symbol('Clock');

export const systemClock: Clock = { now: () => Date.now() };
