/**
 * open-wearables mobile SDK sync bodies.
 * Field names follow backend/app/schemas/providers/mobile_sdk/sync_request.py
 * (camelCase aliases). Metric identifiers follow metric_types.py for provider health_connect.
 */
import type { HealthData, Sample, SleepSession } from '../../src/engine/types';
import { PERSONA_TIME_ZONE } from './schedule';
import { MINUTE_MS, zoneOffset } from './time';

export const SDK_SOURCE_NAME = 'Headroom synthetic persona';
const SDK_VERSION = '1.0.0';

const SOURCE = {
  name: SDK_SOURCE_NAME,
  deviceManufacturer: 'Garmin',
  deviceModel: 'Headroom Persona',
  deviceType: 'watch',
} as const;

export interface SdkSource {
  readonly name: string;
  readonly deviceManufacturer: string;
  readonly deviceModel: string;
  readonly deviceType: string;
}

export interface SdkMetricRecord {
  readonly id: string;
  readonly type: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly zoneOffset: string;
  readonly source: SdkSource;
  readonly value: number;
  readonly unit: string;
}

export interface SdkSleepRecord {
  readonly id: string;
  readonly parentId: string;
  readonly stage: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly zoneOffset: string;
  readonly source: SdkSource;
}

export interface SdkSyncRequest {
  readonly provider: 'health_connect';
  readonly sdkVersion: string;
  readonly syncTimestamp: string;
  readonly syncSessionId: string;
  readonly syncType: 'historical';
  readonly data: {
    readonly records: readonly SdkMetricRecord[];
    readonly sleep: readonly SdkSleepRecord[];
    readonly workouts: readonly [];
  };
}

interface MetricKind {
  readonly key: string;
  readonly type: string;
  readonly unit: string;
  readonly samples: readonly Sample[];
}

const iso = (t: number): string => new Date(t).toISOString();

const metricRecords = (kind: MetricKind, timeZone: string): SdkMetricRecord[] =>
  kind.samples.map((sample) => ({
    id: `marta-${kind.key}-${sample.t}`,
    type: kind.type,
    startDate: iso(sample.t),
    endDate: iso(kind.key === 'steps' ? sample.t + 15 * MINUTE_MS : sample.t),
    zoneOffset: zoneOffset(sample.t, timeZone),
    source: SOURCE,
    value: sample.v,
    unit: kind.unit,
  }));

const sleepRecords = (session: SleepSession, timeZone: string): SdkSleepRecord[] => {
  const parentId = `marta-sleep-${session.end}`;
  const awakeMs = Math.max(0, session.end - session.start - session.asleepMin * MINUTE_MS);
  const asleepStart = session.start + awakeMs;
  const shares = [
    ['light', 0.45],
    ['deep', 0.2],
    ['light', 0.15],
    ['rem', 0.2],
  ] as const;
  const stages: { stage: string; start: number; end: number }[] = [];
  if (awakeMs > 0) stages.push({ stage: 'awake', start: session.start, end: asleepStart });
  const asleepMs = session.end - asleepStart;
  shares.reduce((cursor, [stage, share], index) => {
    const end = index === shares.length - 1 ? session.end : cursor + Math.round(asleepMs * share);
    if (end > cursor) stages.push({ stage, start: cursor, end });
    return end;
  }, asleepStart);
  return stages.map((stage, index) => ({
    id: `${parentId}-${index}`,
    parentId,
    stage: stage.stage,
    startDate: iso(stage.start),
    endDate: iso(stage.end),
    zoneOffset: zoneOffset(stage.start, timeZone),
    source: SOURCE,
  }));
};

interface PayloadItem {
  readonly kind: 'record' | 'sleep';
  readonly record?: SdkMetricRecord;
  readonly sleep?: SdkSleepRecord;
}

const pack = (items: readonly PayloadItem[], chunkSize: number, syncTimestamp: string, sessionId: string): SdkSyncRequest[] => {
  const chunks: PayloadItem[][] = [];
  items.forEach((item) => {
    const last = chunks.at(-1);
    if (last === undefined || last.length >= chunkSize) chunks.push([item]);
    else last.push(item);
  });
  return chunks.map((chunk, index) => ({
    provider: 'health_connect',
    sdkVersion: SDK_VERSION,
    syncTimestamp,
    syncSessionId: `${sessionId}:${index}`,
    syncType: 'historical',
    data: {
      records: chunk.flatMap((item) => (item.record === undefined ? [] : [item.record])),
      sleep: chunk.flatMap((item) => (item.sleep === undefined ? [] : [item.sleep])),
      workouts: [],
    },
  }));
};

/** SDK sync requests, each with at most `chunkSize` records and sleep stages combined. */
export const toSdkPayloads = (
  health: HealthData,
  chunkSize = 5000,
  options: { readonly timeZone?: string; readonly syncSessionId?: string; readonly syncedAt?: number } = {},
): readonly SdkSyncRequest[] => {
  const timeZone = options.timeZone ?? PERSONA_TIME_ZONE;
  const kinds: readonly MetricKind[] = [
    { key: 'stress', type: 'GARMIN_STRESS_LEVEL', unit: 'score', samples: health.stress },
    { key: 'body-battery', type: 'GARMIN_BODY_BATTERY', unit: 'percent', samples: health.bodyBattery },
    { key: 'hr', type: 'HEART_RATE', unit: 'bpm', samples: health.heartRate },
    { key: 'steps', type: 'STEP_COUNT', unit: 'count', samples: health.steps },
    { key: 'hrv', type: 'HEART_RATE_VARIABILITY', unit: 'ms', samples: health.hrv },
  ];
  const records = kinds.flatMap((kind) => metricRecords(kind, timeZone));
  const sleep = health.sleeps.flatMap((session) => sleepRecords(session, timeZone));
  const items: PayloadItem[] = [
    ...records.map((record) => ({ kind: 'record' as const, record })),
    ...sleep.map((stage) => ({ kind: 'sleep' as const, sleep: stage })),
  ];
  if (items.length === 0) return [];
  const latest = Math.max(...kinds.flatMap((kind) => kind.samples.map((sample) => sample.t)), ...health.sleeps.map((session) => session.end));
  const syncedAt = options.syncedAt ?? latest;
  return pack(items, Math.max(1, chunkSize), iso(syncedAt), options.syncSessionId ?? 'headroom-marta');
};

export const payloadItemCount = (payload: SdkSyncRequest): number =>
  payload.data.records.length + payload.data.sleep.length + payload.data.workouts.length;
