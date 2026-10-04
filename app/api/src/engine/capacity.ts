import { ENGINE_CONFIG, type EngineConfig } from './engine.config';
import { formatHoursMinutes } from './format';
import { clamp, mean, median, round0, sampleSd, sum } from './math';
import { buildNights, type Night } from './nights';
import { ensureSorted, samplesIn } from './series';
import { addLocalDays, HOUR_MS, localDate, localParts, MINUTE_MS } from './time';
import type { CapacityComponentKind, EpochMs, HealthData, Sample } from './types';

export type ResilienceSource = 'open_wearables' | 'hrv_cv';

export interface CapacityInputs {
  readonly lastSleepHours: number | null;
  readonly sleepAvg7dHours: number | null;
  readonly lastNightHrv: number | null;
  /** mean of the nightly HRV means of the 7 nights before last night */
  readonly mean7dHrv: number | null;
  readonly bodyBatteryMorning: number | null;
  readonly resilience: number | null;
  readonly resilienceSource: ResilienceSource | null;
  /** minutes after local midnight */
  readonly medianWakeMinutes14d: number | null;
}

/** Sleep hours the capacity is computed for, and where they come from (drives the wording). */
export interface PlannedSleep {
  readonly hours: number | null;
  readonly basis: 'last_night' | 'average_7d' | 'target';
}

export interface CapacityComponent {
  readonly kind: CapacityComponentKind;
  readonly score: number | null;
  /** weight after re-normalisation over available components; 0 when score is null */
  readonly weight: number;
  readonly detail: string;
}

export interface CapacityResult {
  /** null only when no component has data */
  readonly score: number | null;
  readonly components: readonly CapacityComponent[];
}

const LAST_NIGHT_WINDOW_H = 18;
const BODY_BATTERY_WAKE_WINDOW_MIN = 60;
const RESILIENCE_MIN_NIGHTS = 5;

const nightsBetween = (nights: readonly Night[], from: string, to: string): readonly Night[] =>
  nights.filter((n) => n.date >= from && n.date <= to);

const hrvMeans = (nights: readonly Night[]): readonly number[] => nights.flatMap((n) => (n.hrvMean === null ? [] : [n.hrvMean]));

const asleepHours = (night: Night): number => night.session.asleepMin / 60;

/** open-wearables formula: clamp(100 * (floor - cv%) / (floor - ceiling), 0, 100) over >= 5 nights. */
const hrvCvResilience = (nightMeans: readonly number[], cfg: EngineConfig): number | null => {
  const m = mean(nightMeans);
  const sd = sampleSd(nightMeans);
  if (nightMeans.length < RESILIENCE_MIN_NIGHTS || m === null || m <= 0 || sd === null) return null;
  const cvPct = (100 * sd) / m;
  return round0(
    clamp((100 * (cfg.RESILIENCE_CV_FLOOR_PCT - cvPct)) / (cfg.RESILIENCE_CV_FLOOR_PCT - cfg.RESILIENCE_CV_CEILING_PCT), 0, 100),
  );
};

/** First reading within 60 min after waking, else the highest reading within 60 min either side. */
const bodyBatteryAtWake = (bodyBattery: readonly Sample[], wake: EpochMs): number | null => {
  const sorted = ensureSorted(bodyBattery);
  const window = BODY_BATTERY_WAKE_WINDOW_MIN * MINUTE_MS;
  const after = samplesIn(sorted, wake, wake + window + 1);
  if (after.length > 0) return after[0]!.v;
  const around = samplesIn(sorted, wake - window, wake + window + 1);
  return around.length > 0 ? Math.max(...around.map((s) => s.v)) : null;
};

export const deriveCapacityInputs = (
  health: HealthData,
  now: EpochMs,
  timeZone: string,
  cfg: EngineConfig = ENGINE_CONFIG,
): CapacityInputs => {
  const today = localDate(now, timeZone);
  const nights = buildNights(health.sleeps, health.hrv, timeZone).filter((n) => n.session.end <= now);
  const lastNight = nights.filter((n) => n.session.end > now - LAST_NIGHT_WINDOW_H * HOUR_MS).at(-1) ?? null;
  const reference = lastNight?.date ?? today;
  const computedResilience = hrvCvResilience(hrvMeans(nightsBetween(nights, addLocalDays(reference, -6), reference)), cfg);
  const wakeMinutes = nightsBetween(nights, addLocalDays(today, -13), today).map((n) => {
    const { hour, minute } = localParts(n.session.end, timeZone);
    return hour * 60 + minute;
  });
  const resilienceSource: ResilienceSource | null =
    health.resilienceScore !== null ? 'open_wearables' : computedResilience !== null ? 'hrv_cv' : null;

  return {
    lastSleepHours: lastNight ? asleepHours(lastNight) : null,
    sleepAvg7dHours: mean(nightsBetween(nights, addLocalDays(today, -6), today).map(asleepHours)),
    lastNightHrv: lastNight?.hrvMean ?? null,
    mean7dHrv: mean(hrvMeans(nightsBetween(nights, addLocalDays(reference, -7), addLocalDays(reference, -1)))),
    bodyBatteryMorning: lastNight ? bodyBatteryAtWake(health.bodyBattery, lastNight.session.end) : null,
    resilience: health.resilienceScore ?? computedResilience,
    resilienceSource,
    medianWakeMinutes14d: median(wakeMinutes),
  };
};

interface RawComponent {
  readonly kind: CapacityComponentKind;
  readonly score: number | null;
  readonly detail: string;
}

const sleepComponent = (sleep: PlannedSleep, cfg: EngineConfig): RawComponent => {
  const target = formatHoursMinutes(cfg.SLEEP_TARGET_H);
  if (sleep.hours === null) {
    const missing = {
      last_night: 'No sleep recorded last night',
      average_7d: 'No sleep history for the last 7 days',
      target: 'No sleep target set',
    } as const;
    return { kind: 'sleep', score: null, detail: missing[sleep.basis] };
  }
  const hours = formatHoursMinutes(sleep.hours);
  const detail = {
    last_night: `${hours} last night (target ${target})`,
    average_7d: `${hours} planned (your 7-day average; target ${target})`,
    target: `${hours} planned (sleep target)`,
  } as const;
  return { kind: 'sleep', score: clamp(sleep.hours / cfg.SLEEP_TARGET_H, 0, 1) * 100, detail: detail[sleep.basis] };
};

const hrvComponent = (inputs: CapacityInputs): RawComponent => {
  if (inputs.lastNightHrv === null) return { kind: 'hrv', score: null, detail: 'No HRV recorded last night' };
  if (inputs.mean7dHrv === null || inputs.mean7dHrv <= 0) {
    return { kind: 'hrv', score: null, detail: 'Not enough HRV history for a 7-day average' };
  }
  const ratio = inputs.lastNightHrv / inputs.mean7dHrv;
  const pct = round0((ratio - 1) * 100);
  const detail =
    pct < 0
      ? `HRV ${-pct}% below your 7-day average`
      : pct > 0
        ? `HRV ${pct}% above your 7-day average`
        : 'HRV in line with your 7-day average';
  return { kind: 'hrv', score: clamp(50 + 250 * (ratio - 1), 0, 100), detail };
};

const bodyBatteryComponent = (inputs: CapacityInputs): RawComponent =>
  inputs.bodyBatteryMorning === null
    ? { kind: 'bodyBattery', score: null, detail: 'No Body Battery reading at wake-up' }
    : {
        kind: 'bodyBattery',
        score: clamp(inputs.bodyBatteryMorning, 0, 100),
        detail: `Body Battery ${round0(inputs.bodyBatteryMorning)} at wake-up`,
      };

const resilienceComponent = (inputs: CapacityInputs): RawComponent => {
  if (inputs.resilience === null) {
    return { kind: 'resilience', score: null, detail: `Not enough nights for a resilience score (${RESILIENCE_MIN_NIGHTS} needed)` };
  }
  const source =
    inputs.resilienceSource === 'hrv_cv' ? 'HRV stability over the last 7 nights' : 'open-wearables';
  return { kind: 'resilience', score: clamp(inputs.resilience, 0, 100), detail: `Resilience ${round0(inputs.resilience)} (${source})` };
};

const roundWeight = (weight: number): number => Math.round(weight * 10_000) / 10_000;

/** Architecture 7.6: weighted components, weights re-normalised over the ones with data. */
export const capacity = (inputs: CapacityInputs, sleep: PlannedSleep, cfg: EngineConfig = ENGINE_CONFIG): CapacityResult => {
  const raw = [sleepComponent(sleep, cfg), hrvComponent(inputs), bodyBatteryComponent(inputs), resilienceComponent(inputs)];
  const totalWeight = sum(raw.filter((c) => c.score !== null).map((c) => cfg.CAPACITY_WEIGHTS[c.kind]));
  const weightOf = (c: RawComponent): number => (c.score === null || totalWeight <= 0 ? 0 : cfg.CAPACITY_WEIGHTS[c.kind] / totalWeight);
  const score = totalWeight <= 0 ? null : round0(sum(raw.map((c) => weightOf(c) * (c.score ?? 0))));
  return {
    score,
    components: raw.map((c) => ({
      kind: c.kind,
      score: c.score === null ? null : round0(c.score),
      weight: roundWeight(weightOf(c)),
      detail: c.detail,
    })),
  };
};
