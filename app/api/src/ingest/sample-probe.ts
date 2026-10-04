import { Inject, Injectable } from '@nestjs/common';
import type { UserKey } from '../../../contracts/api-contract';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OPEN_WEARABLES_READER, type OpenWearablesReader, type SeriesType } from '../open-wearables/open-wearables.client';

const HOUR_MS = 3_600_000;
const LOOKBACK_MS = 48 * HOUR_MS;

const SERIES: readonly SeriesType[] = [
  'heart_rate',
  'garmin_stress_level',
  'garmin_body_battery',
  'steps',
  'heart_rate_variability_rmssd',
];

export interface SampleProbe {
  hasNewerThan(userKey: UserKey, latestSampleAt: string | null, now: number): Promise<boolean>;
}

export const SAMPLE_PROBE = Symbol('SampleProbe');

/** True when open-wearables has a sample strictly after the connector's cursor (any sample when the cursor is null). */
@Injectable()
export class OpenWearablesSampleProbe implements SampleProbe {
  constructor(
    @Inject(OPEN_WEARABLES_READER) private readonly reader: OpenWearablesReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async hasNewerThan(userKey: UserKey, latestSampleAt: string | null, now: number): Promise<boolean> {
    const threshold = latestSampleAt === null ? null : Date.parse(latestSampleAt);
    const finite = threshold !== null && Number.isFinite(threshold) ? threshold : null;
    const start = finite ?? now - LOOKBACK_MS;
    const samples = await this.reader.timeseries(this.config.owUserIds[userKey], SERIES, start, now);
    return samples.some((sample) => {
      const t = Date.parse(sample.timestamp);
      return Number.isFinite(t) && (finite === null || t > finite);
    });
  }
}
