import { z } from 'zod';
import { defaultFetch, defaultSleep, type FetchFn, type SleepFn } from '../common/http';
import type { components } from './generated/openapi';

type Schemas = components['schemas'];
export type SeriesType = Schemas['SeriesType'];

const timeSeriesSampleSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  value: z.number(),
  is_daily_total: z.boolean().nullish(),
});

const sleepSessionSchema = z.object({
  id: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_seconds: z.number(),
  sleep_duration_seconds: z.number().nullish(),
  stages: z
    .object({
      awake_minutes: z.number().nullish(),
      light_minutes: z.number().nullish(),
      deep_minutes: z.number().nullish(),
      rem_minutes: z.number().nullish(),
    })
    .nullish(),
  is_nap: z.boolean().default(false),
});

const workoutSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().nullish(),
  start_time: z.string(),
  end_time: z.string(),
});

const healthScoreSchema = z.object({
  category: z.string(),
  value: z.number().nullish(),
  recorded_at: z.string(),
});

export type TimeSeriesSample = z.infer<typeof timeSeriesSampleSchema>;
export type SleepSessionRecord = z.infer<typeof sleepSessionSchema>;
export type WorkoutRecord = z.infer<typeof workoutSchema>;

/** Compile-time guard: the generated open-wearables types must still fit what we parse at runtime. */
type Fits<T extends true> = T;
export type GeneratedTypesFit = [
  Fits<Schemas['TimeSeriesSample'] extends TimeSeriesSample ? true : false>,
  Fits<Schemas['SleepSession'] extends z.input<typeof sleepSessionSchema> ? true : false>,
  Fits<Schemas['Workout'] extends WorkoutRecord ? true : false>,
  Fits<Schemas['HealthScoreResponse'] extends z.infer<typeof healthScoreSchema> ? true : false>,
];

const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    pagination: z.object({ has_more: z.boolean(), next_cursor: z.string().nullish() }),
  });

export type OpenWearablesErrorKind = 'http' | 'network' | 'timeout' | 'invalid_response';

export class OpenWearablesError extends Error {
  override readonly name = 'OpenWearablesError';

  constructor(
    readonly kind: OpenWearablesErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface OpenWearablesClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: FetchFn;
  readonly sleep?: SleepFn;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly pageSize?: number;
}

/** What the rest of the api needs from open-wearables; the class below is the HTTP implementation. */
export interface OpenWearablesReader {
  timeseries(userId: string, types: readonly SeriesType[], start: number, end: number): Promise<readonly TimeSeriesSample[]>;
  sleepSessions(userId: string, start: number, end: number): Promise<readonly SleepSessionRecord[]>;
  workouts(userId: string, start: number, end: number): Promise<readonly WorkoutRecord[]>;
  resilienceScore(userId: string, date: string): Promise<number | null>;
}

export const OPEN_WEARABLES_READER = Symbol('OpenWearablesReader');

const MAX_PAGES = 1_000;
const DAY_MS = 86_400_000;

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

const daysBefore = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

const isRetryable = (error: unknown): boolean =>
  error instanceof OpenWearablesError &&
  (error.kind === 'network' ||
    error.kind === 'timeout' ||
    (error.kind === 'http' && error.status !== null && (error.status >= 500 || error.status === 429)));

const transportError = (error: unknown): OpenWearablesError =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? new OpenWearablesError('timeout', 'open-wearables did not answer in time')
    : new OpenWearablesError('network', `open-wearables is unreachable (${error instanceof Error ? error.message : String(error)})`);

const detailOf = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  const parsed = z.object({ detail: z.unknown() }).safeParse(JSON.parse(text || 'null'));
  const detail = parsed.success ? parsed.data.detail : text;
  return (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300);
};

export class OpenWearablesClient implements OpenWearablesReader {
  private readonly baseUrl: string;
  private readonly fetch: FetchFn;
  private readonly sleep: SleepFn;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly pageSize: number;

  constructor(private readonly options: OpenWearablesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retries = options.retries ?? 3;
    this.pageSize = options.pageSize ?? 1_000;
  }

  timeseries(userId: string, types: readonly SeriesType[], start: number, end: number): Promise<readonly TimeSeriesSample[]> {
    const params = new URLSearchParams([
      ...types.map((type): [string, string] => ['types', type]),
      ['start_time', iso(start)],
      ['end_time', iso(end)],
      ['resolution', 'raw'],
    ]);
    return this.paginate(`/users/${userId}/timeseries`, params, timeSeriesSampleSchema);
  }

  sleepSessions(userId: string, start: number, end: number): Promise<readonly SleepSessionRecord[]> {
    const params = new URLSearchParams({ start_date: iso(start), end_date: iso(end) });
    return this.paginate(`/users/${userId}/events/sleep`, params, sleepSessionSchema);
  }

  workouts(userId: string, start: number, end: number): Promise<readonly WorkoutRecord[]> {
    const params = new URLSearchParams({ start_date: iso(start), end_date: iso(end) });
    return this.paginate(`/users/${userId}/events/workouts`, params, workoutSchema);
  }

  async resilienceScore(userId: string, date: string): Promise<number | null> {
    const params = new URLSearchParams({
      category: 'resilience',
      start_date: daysBefore(date, 7),
      end_date: date,
      limit: '100',
    });
    const page = await this.getParsed(`/users/${userId}/health-scores`, params, pageSchema(healthScoreSchema));
    const [latest] = page.data
      .filter((score) => score.category === 'resilience' && typeof score.value === 'number')
      .toSorted((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
    return latest?.value ?? null;
  }

  private async paginate<T extends z.ZodType>(
    path: string,
    params: URLSearchParams,
    item: T,
    cursor: string | null = null,
    collected: readonly z.output<T>[] = [],
    pages = 0,
  ): Promise<readonly z.output<T>[]> {
    if (pages >= MAX_PAGES) throw new OpenWearablesError('invalid_response', `${path} returned more than ${MAX_PAGES} pages`);
    const paging: [string, string][] = [['limit', String(this.pageSize)], ...(cursor ? [['cursor', cursor] as [string, string]] : [])];
    const query = new URLSearchParams([...params, ...paging]);
    const page = await this.getParsed(path, query, pageSchema(item));
    const all = [...collected, ...page.data];
    const next = page.pagination.has_more ? (page.pagination.next_cursor ?? null) : null;
    if (next === null) return all;
    if (next === cursor) throw new OpenWearablesError('invalid_response', `${path} repeated pagination cursor`);
    return this.paginate(path, params, item, next, all, pages + 1);
  }

  private async getParsed<T extends z.ZodType>(path: string, params: URLSearchParams, schema: T): Promise<z.output<T>> {
    const body = await this.withRetries(`${this.baseUrl}/api/v1${path}?${params}`, 0);
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new OpenWearablesError('invalid_response', `${path} returned an unexpected shape: ${result.error.issues[0]?.message ?? ''}`);
    }
    return result.data;
  }

  private async withRetries(url: string, attempt: number): Promise<unknown> {
    try {
      return await this.getJson(url);
    } catch (error) {
      if (!isRetryable(error) || attempt >= this.retries) throw error;
      await this.sleep(250 * 2 ** attempt);
      return this.withRetries(url, attempt + 1);
    }
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetch(url, {
      headers: { 'X-Open-Wearables-API-Key': this.options.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      throw transportError(error);
    });
    if (!response.ok) {
      throw new OpenWearablesError('http', `open-wearables answered ${response.status}: ${await detailOf(response)}`, response.status);
    }
    return response.json().catch((error: unknown) => {
      throw error instanceof Error && error.name === 'TimeoutError'
        ? transportError(error)
        : new OpenWearablesError('invalid_response', 'open-wearables returned invalid JSON');
    });
  }
}
