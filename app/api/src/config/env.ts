import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type { UserKey } from '../../../contracts/api-contract';

export type IngestMode = 'webhook' | 'poll';

export interface AppConfig {
  readonly port: number;
  readonly webOrigin: string;
  readonly openWearables: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly webhookSecret: string;
  };
  readonly owUserIds: Readonly<Record<UserKey, string>>;
  readonly connectorUrl: string;
  readonly ingestMode: IngestMode;
  readonly dbPath: string;
  readonly calendarDir: string;
  readonly llm: { readonly baseUrl: string; readonly apiKey: string | null; readonly model: string } | null;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const required = (message = 'is required') => ({
  error: (issue: { readonly input?: unknown }) => (issue.input === undefined ? 'is required' : message),
});

const url = (fallback?: string) => {
  const schema = z.url(required('must be an absolute URL'));
  return fallback === undefined ? schema : schema.default(fallback);
};

export const DEFAULT_DB_PATH = 'data/local/headroom.sqlite';

const envSchema = z.object({
  PORT: z.coerce.number(required('must be a port number')).int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: url('http://localhost:4200'),
  OW_BASE_URL: url('http://localhost:8000'),
  OW_API_KEY: z.string(required()).min(1, 'is required'),
  OW_USER_ID_JAKUB: z.uuid(required('must be an open-wearables user UUID')),
  OW_USER_ID_MARTA: z.uuid(required('must be an open-wearables user UUID')),
  OW_WEBHOOK_SECRET: z.string(required()).startsWith('whsec_', 'must start with whsec_'),
  CONNECTOR_URL: url('http://localhost:8787'),
  INGEST_MODE: z.enum(['webhook', 'poll'], required('must be "webhook" or "poll"')).default('webhook'),
  DB_PATH: z.string().min(1).default(DEFAULT_DB_PATH),
  CALENDAR_DIR: z.string().min(1).default('data/calendars'),
  LLM_BASE_URL: z.url('must be an absolute URL').optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

const withoutEmptyValues = (raw: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== ''),
  );

export const resolvePath = (apiRoot: string, path: string): string =>
  path === ':memory:' || isAbsolute(path) ? path : resolve(apiRoot, path);

/** Validates the api environment; throws a ConfigError naming every bad variable (values are never echoed). */
export const parseEnv = (raw: Readonly<Record<string, string | undefined>>, apiRoot: string): AppConfig => {
  const result = envSchema.safeParse(withoutEmptyValues(raw));
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(['Invalid api configuration:', ...lines].join('\n'));
  }
  const env = result.data;
  return {
    port: env.PORT,
    webOrigin: env.WEB_ORIGIN,
    openWearables: { baseUrl: env.OW_BASE_URL, apiKey: env.OW_API_KEY, webhookSecret: env.OW_WEBHOOK_SECRET },
    owUserIds: { jakub: env.OW_USER_ID_JAKUB, marta: env.OW_USER_ID_MARTA },
    connectorUrl: env.CONNECTOR_URL,
    ingestMode: env.INGEST_MODE,
    dbPath: resolvePath(apiRoot, env.DB_PATH),
    calendarDir: resolvePath(apiRoot, env.CALENDAR_DIR),
    llm:
      env.LLM_BASE_URL && env.LLM_MODEL
        ? { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY ?? null, model: env.LLM_MODEL }
        : null,
  };
};
