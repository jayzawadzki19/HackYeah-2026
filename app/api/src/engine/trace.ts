import type { Baseline } from './baseline';
import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { lowerBound } from './series';
import { HOUR_MS, localHour, MINUTE_MS } from './time';
import type { EngineMeeting, EpochMs, HealthData, Sample } from './types';

export interface TracePoint {
  readonly t: EpochMs;
  readonly stress: number | null;
  readonly heartRate: number | null;
  /** Present on a meeting trace. The live window has no baseline band. */
  readonly baselineStress?: number | null;
}

const TRACE_BEFORE_MIN = 30;
const TRACE_AFTER_MIN = 120;

const valueAt = (samples: readonly Sample[], t: EpochMs): number | null => {
  const index = lowerBound(samples, t);
  const sample = samples[index];
  return sample !== undefined && sample.t === t ? sample.v : null;
};

/** Union of two ascending series inside [start, end], null where a series has no sample at that instant. */
const mergeSeries = (
  stress: readonly Sample[],
  heartRate: readonly Sample[],
  start: EpochMs,
  end: EpochMs,
  baselineAt: (t: EpochMs) => number | null,
): readonly TracePoint[] => {
  const timestamps = [
    ...stress.slice(lowerBound(stress, start), lowerBound(stress, end + 1)),
    ...heartRate.slice(lowerBound(heartRate, start), lowerBound(heartRate, end + 1)),
  ]
    .map((sample) => sample.t)
    .filter((t, index, all) => all.indexOf(t) === index)
    .sort((a, b) => a - b);
  return timestamps.map((t) => ({
    t,
    stress: valueAt(stress, t),
    heartRate: valueAt(heartRate, t),
    baselineStress: baselineAt(t),
  }));
};

/** Stress and heart rate from 30 min before the meeting to 120 min after it, with the hourly baseline. */
export const meetingTrace = (
  meeting: Pick<EngineMeeting, 'start' | 'end'>,
  health: HealthData,
  baseline: Baseline,
  timeZone: string,
): readonly TracePoint[] =>
  mergeSeries(
    health.stress,
    health.heartRate,
    meeting.start - TRACE_BEFORE_MIN * MINUTE_MS,
    meeting.end + TRACE_AFTER_MIN * MINUTE_MS,
    (t) => baseline.stressByHour[localHour(t, timeZone)] ?? null,
  );

/** The last LIVE_WINDOW_H hours up to `now`, for the live tile. No baseline band. */
export const livePoints = (health: HealthData, now: EpochMs, cfg: EngineConfig = ENGINE_CONFIG): readonly TracePoint[] =>
  mergeSeries(health.stress, health.heartRate, now - cfg.LIVE_WINDOW_H * HOUR_MS, now, () => null).map(({ t, stress, heartRate }) => ({
    t,
    stress,
    heartRate,
  }));
