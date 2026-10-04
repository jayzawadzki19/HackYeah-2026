import type { Rating, UserKey } from '../../../contracts/api-contract';
import type { CalendarFile } from '../../src/calendar/calendar-file';
import { type CalendarProvider, CalendarUnavailableError } from '../../src/calendar/calendar.provider';
import { toEngineEvent } from '../../src/calendar/json-calendar.provider';
import type { Clock } from '../../src/common/clock';
import type { EngineEvent, EngineMeeting, HealthData, Measured, Reflection } from '../../src/engine/types';
import type { Baseline, ForecastEngine, ForecastInput, ForecastResult, MeetingLoad, TracePoint } from '../../src/forecast/engine.port';
import type { HealthSource } from '../../src/open-wearables/health.repository';
import { forecastFixture } from './forecast-fixture';

export class FakeClock implements Clock {
  constructor(public t: number) {}

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }
}

export class FakeCalendar implements CalendarProvider {
  constructor(public files: Partial<Record<UserKey, CalendarFile>>) {}

  async profile(userKey: UserKey) {
    const { displayName, isSynthetic, timeZone } = this.file(userKey);
    return { userKey, displayName, isSynthetic, timeZone };
  }

  async events(userKey: UserKey) {
    return this.file(userKey).events.map(toEngineEvent);
  }

  async people(userKey: UserKey) {
    return this.file(userKey).people;
  }

  async seedReflections(userKey: UserKey) {
    return this.file(userKey).reflections;
  }

  private file(userKey: UserKey): CalendarFile {
    const file = this.files[userKey];
    if (!file) throw new CalendarUnavailableError(userKey, `cannot read ${userKey}.json (missing)`);
    return file;
  }
}

export const EMPTY_HEALTH: HealthData = {
  stress: [],
  heartRate: [],
  steps: [],
  bodyBattery: [],
  hrv: [],
  sleeps: [],
  resilienceScore: null,
};

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export const deferred = <T>(): Deferred<T> => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
};

/** Answers with `data` (or throws `failure`); `gate`, when set, holds every load until resolved. */
export class FakeHealthSource implements HealthSource {
  data: HealthData = EMPTY_HEALTH;
  failure: Error | null = null;
  gate: Deferred<void> | null = null;
  readonly calls: { readonly userKey: UserKey; readonly now: number }[] = [];

  async load(userKey: UserKey, now: number): Promise<HealthData> {
    this.calls.push({ userKey, now });
    await this.gate?.promise;
    if (this.failure) throw this.failure;
    return this.data;
  }
}

export class FakeEngine implements ForecastEngine {
  readonly inputs: ForecastInput[] = [];
  result: (input: ForecastInput) => ForecastResult = (input) => forecastFixture({ computedAt: input.now });
  trace: readonly TracePoint[] = [];
  pending: readonly EngineMeeting[] = [];
  readonly traceCalls: { readonly meeting: EngineMeeting; readonly baseline: Baseline; readonly timeZone: string }[] = [];

  buildForecast(input: ForecastInput): ForecastResult {
    this.inputs.push(input);
    return this.result(input);
  }

  meetingTrace(meeting: EngineMeeting, _health: HealthData, baseline: Baseline, timeZone: string): readonly TracePoint[] {
    this.traceCalls.push({ meeting, baseline, timeZone });
    return this.trace;
  }

  pendingCheckIns(_events: readonly EngineEvent[], _reflections: readonly Reflection[]): readonly EngineMeeting[] {
    return this.pending;
  }

  reflectionMessage(rating: Rating, measured: Measured<MeetingLoad> | undefined): string {
    return `rating ${rating}, measured ${measured?.kind ?? 'none'}`;
  }
}
