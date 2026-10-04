import type { LivePointDto } from '@contracts';

export interface LiveReadout {
  readonly at: string;
  readonly signal: 'stress' | 'hr';
  readonly stress: number | null;
  readonly heartRate: number | null;
  readonly text: string;
}

const textFor = (stress: number | null, heartRate: number | null): string => {
  if (stress !== null && heartRate !== null) return `Right now: stress ${stress} / heart rate ${heartRate}`;
  if (stress !== null) return `Right now: stress ${stress}`;
  return `Right now: heart rate ${heartRate}`;
};

/** Latest sample that actually measured something. Stress wins; heart rate is the fallback. */
export const liveReadout = (points: readonly LivePointDto[]): LiveReadout | null => {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point || (point.stress === null && point.heartRate === null)) continue;
    return {
      at: point.t,
      signal: point.stress === null ? 'hr' : 'stress',
      stress: point.stress,
      heartRate: point.heartRate,
      text: textFor(point.stress, point.heartRate),
    };
  }
  return null;
};
