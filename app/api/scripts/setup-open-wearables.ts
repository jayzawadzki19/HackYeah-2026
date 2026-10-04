import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvironment, mergeEnvFile, parseEnvFile } from '../src/config/env-file';
import { defaultFetch, type FetchFn } from '../src/common/http';

const TARGET_WEBHOOK_URL = 'http://host.docker.internal:3001/webhooks/open-wearables';
const SPIKE_USER_ID = 'dec167e8-efd9-4356-a7e7-b27bf8ab5c9f';
const SPIKE_USER_NAME = 'Webhook Spike';
const SPIKE_KEY_NAME = 'headroom-spike';
const SPIKE_ENDPOINT_ID = 'ep_3KCsGBykvgKzQhKLFrmlXEdxgZm';
const HEADROOM_KEY_NAME = 'headroom';

const WEBHOOK_EVENTS = [
  'series.heart_rate.created',
  'series.garmin_stress_level.created',
  'series.garmin_body_battery.created',
  'series.heart_rate_variability_rmssd.created',
  'series.steps.created',
  'sleep.created',
  'workout.created',
] as const;

const JAKUB_EXTERNAL_ID = 'jakub-live';
const MARTA_EXTERNAL_ID = 'persona-founder';

export interface SetupReport {
  readonly apiKeyId: string;
  readonly apiKeyReused: boolean;
  readonly jakubUserId: string;
  readonly martaUserId: string;
  readonly webhookEndpointId: string;
  readonly deletedUserIds: readonly string[];
  readonly deletedKeyIds: readonly string[];
  readonly deletedEndpointIds: readonly string[];
}

export interface SetupOptions {
  readonly baseUrl: string;
  readonly openWearablesEnvPath: string;
  readonly apiEnvPath: string;
  readonly connectorEnvPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchFn;
  readonly readText?: (path: string) => string | null;
  readonly writeText?: (path: string, text: string) => void;
  readonly log?: (line: string) => void;
}

class SetupError extends Error {
  override readonly name = 'SetupError';
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const textField = (value: unknown, field: string, label: string): string => {
  if (!isRecord(value) || typeof value[field] !== 'string' || value[field] === '') {
    throw new SetupError(`${label} is missing ${field}.`);
  }
  return value[field];
};

const optionalText = (value: unknown, field: string): string | null =>
  isRecord(value) && typeof value[field] === 'string' ? value[field] : null;

interface OwClient {
  login(email: string, password: string): Promise<string>;
  listApiKeys(token: string): Promise<readonly { id: string; name: string }[]>;
  createApiKey(token: string, name: string): Promise<{ id: string; key: string }>;
  rotateApiKey(token: string, id: string): Promise<{ id: string; key: string }>;
  deleteApiKey(token: string, id: string): Promise<void>;
  listUsers(apiKey: string, query: Readonly<Record<string, string>>): Promise<readonly { id: string; external_user_id: string | null; email: string | null; first_name: string | null; last_name: string | null }[]>;
  createUser(apiKey: string, body: { first_name: string; last_name: string; email: string; external_user_id: string }): Promise<{ id: string }>;
  deleteUser(apiKey: string, id: string): Promise<boolean>;
  listEndpoints(token: string): Promise<readonly { id: string; url: string }[]>;
  createEndpoint(token: string): Promise<{ id: string }>;
  updateEndpoint(token: string, id: string): Promise<void>;
  deleteEndpoint(token: string, id: string): Promise<void>;
  endpointSecret(token: string, id: string): Promise<string>;
}

const readJson = async (response: Response, label: string): Promise<unknown> => {
  const text = await response.text();
  if (!response.ok) throw new SetupError(`${label} failed (${response.status}).`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SetupError(`${label} returned invalid JSON.`);
  }
};

const discard = (response: Response): Promise<void> => response.text().then(() => undefined, () => undefined);

const authHeaders = (token: string): HeadersInit => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

const apiKeyHeaders = (apiKey: string): HeadersInit => ({ 'x-open-wearables-api-key': apiKey, 'content-type': 'application/json' });

const createClient = (baseUrl: string, fetch: FetchFn): OwClient => {
  const root = baseUrl.replace(/\/+$/, '');
  const url = (path: string) => `${root}/api/v1${path}`;
  const send = async (label: string, path: string, init: RequestInit): Promise<Response> => {
    const response = await fetch(url(path), init).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new SetupError(`${label} could not reach open-wearables (${message}).`);
    });
    return response;
  };
  return {
    async login(email, password) {
      const body = new URLSearchParams({ username: email, password, grant_type: 'password' });
      const response = await send('POST /auth/login', '/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const payload = await readJson(response, 'POST /auth/login');
      return textField(payload, 'access_token', 'POST /auth/login');
    },
    async listApiKeys(token) {
      const response = await send('GET /developer/api-keys', '/developer/api-keys', { headers: authHeaders(token) });
      const payload = await readJson(response, 'GET /developer/api-keys');
      if (!Array.isArray(payload)) throw new SetupError('GET /developer/api-keys returned an unexpected body.');
      return payload.map((item) => ({ id: textField(item, 'id', 'API key'), name: textField(item, 'name', 'API key') }));
    },
    async createApiKey(token, name) {
      const response = await send('POST /developer/api-keys', '/developer/api-keys', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name }),
      });
      const payload = await readJson(response, 'POST /developer/api-keys');
      return { id: textField(payload, 'id', 'POST /developer/api-keys'), key: textField(payload, 'key', 'POST /developer/api-keys') };
    },
    async rotateApiKey(token, id) {
      const response = await send('POST /developer/api-keys/rotate', `/developer/api-keys/${id}/rotate`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      const payload = await readJson(response, 'POST /developer/api-keys/rotate');
      return { id: textField(payload, 'id', 'POST /developer/api-keys/rotate'), key: textField(payload, 'key', 'POST /developer/api-keys/rotate') };
    },
    async deleteApiKey(token, id) {
      const response = await send('DELETE /developer/api-keys', `/developer/api-keys/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      await discard(response);
      if (!response.ok && response.status !== 404) throw new SetupError(`DELETE /developer/api-keys failed (${response.status}).`);
    },
    async listUsers(apiKey, query) {
      const params = new URLSearchParams({ limit: '100', ...query });
      const response = await send('GET /users', `/users?${params}`, { headers: apiKeyHeaders(apiKey) });
      const payload = await readJson(response, 'GET /users');
      if (!isRecord(payload) || !Array.isArray(payload.items)) throw new SetupError('GET /users returned an unexpected body.');
      return payload.items.map((item) => ({
        id: textField(item, 'id', 'user'),
        external_user_id: optionalText(item, 'external_user_id'),
        email: optionalText(item, 'email'),
        first_name: optionalText(item, 'first_name'),
        last_name: optionalText(item, 'last_name'),
      }));
    },
    async createUser(apiKey, body) {
      const response = await send('POST /users', '/users', {
        method: 'POST',
        headers: apiKeyHeaders(apiKey),
        body: JSON.stringify(body),
      });
      const payload = await readJson(response, 'POST /users');
      return { id: textField(payload, 'id', 'POST /users') };
    },
    async deleteUser(apiKey, id) {
      const response = await send('DELETE /users', `/users/${id}`, { method: 'DELETE', headers: apiKeyHeaders(apiKey) });
      await discard(response);
      if (response.status === 404) return false;
      if (!response.ok) throw new SetupError(`DELETE /users failed (${response.status}).`);
      return true;
    },
    async listEndpoints(token) {
      const response = await send('GET /webhooks/endpoints', '/webhooks/endpoints', { headers: authHeaders(token) });
      const payload = await readJson(response, 'GET /webhooks/endpoints');
      if (!Array.isArray(payload)) throw new SetupError('GET /webhooks/endpoints returned an unexpected body.');
      return payload.map((item) => ({ id: textField(item, 'id', 'endpoint'), url: textField(item, 'url', 'endpoint') }));
    },
    async createEndpoint(token) {
      const response = await send('POST /webhooks/endpoints', '/webhooks/endpoints', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ url: TARGET_WEBHOOK_URL, description: 'Headroom api', filter_types: WEBHOOK_EVENTS }),
      });
      const payload = await readJson(response, 'POST /webhooks/endpoints');
      return { id: textField(payload, 'id', 'POST /webhooks/endpoints') };
    },
    async updateEndpoint(token, id) {
      const response = await send('PATCH /webhooks/endpoints', `/webhooks/endpoints/${id}`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ description: 'Headroom api', filter_types: WEBHOOK_EVENTS }),
      });
      await discard(response);
      if (!response.ok) throw new SetupError(`PATCH /webhooks/endpoints failed (${response.status}).`);
    },
    async deleteEndpoint(token, id) {
      const response = await send('DELETE /webhooks/endpoints', `/webhooks/endpoints/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      await discard(response);
      if (!response.ok && response.status !== 404) throw new SetupError(`DELETE /webhooks/endpoints failed (${response.status}).`);
    },
    async endpointSecret(token, id) {
      const response = await send('GET /webhooks/endpoints/secret', `/webhooks/endpoints/${id}/secret`, {
        headers: authHeaders(token),
      });
      const payload = await readJson(response, 'GET /webhooks/endpoints/secret');
      return textField(payload, 'key', 'GET /webhooks/endpoints/secret');
    },
  };
};

const credentials = (fileText: string | null, env: Readonly<Record<string, string | undefined>>): { email: string; password: string } => {
  const file = fileText === null ? {} : parseEnvFile(fileText);
  const email = env.OW_ADMIN_EMAIL || file.ADMIN_EMAIL;
  const password = env.OW_ADMIN_PASSWORD || file.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new SetupError('Missing ADMIN_EMAIL or ADMIN_PASSWORD in the open-wearables config (or OW_ADMIN_EMAIL / OW_ADMIN_PASSWORD).');
  }
  return { email, password };
};

const displayName = (user: { first_name: string | null; last_name: string | null }): string =>
  [user.first_name, user.last_name].filter((part): part is string => part !== null && part !== '').join(' ');

const ensureUser = async (
  client: OwClient,
  apiKey: string,
  externalId: string,
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> => {
  const byExternal = await client.listUsers(apiKey, { external_user_id: externalId });
  const existing = byExternal.find((user) => user.external_user_id === externalId);
  if (existing) return existing.id;
  const byEmail = await client.listUsers(apiKey, { email });
  const sameEmail = byEmail.find((user) => user.email === email);
  if (sameEmail) return sameEmail.id;
  return (await client.createUser(apiKey, { first_name: firstName, last_name: lastName, email, external_user_id: externalId })).id;
};

const ensureApiKey = async (
  client: OwClient,
  token: string,
  existingKey: string | undefined,
): Promise<{ id: string; key: string; reused: boolean }> => {
  const keys = await client.listApiKeys(token);
  const headroom = keys.find((key) => key.name === HEADROOM_KEY_NAME);
  if (headroom && existingKey) return { id: headroom.id, key: existingKey, reused: true };
  if (headroom) {
    const rotated = await client.rotateApiKey(token, headroom.id);
    return { id: rotated.id, key: rotated.key, reused: false };
  }
  const created = await client.createApiKey(token, HEADROOM_KEY_NAME);
  return { id: created.id, key: created.key, reused: false };
};

const isLeftoverEndpoint = (endpoint: { id: string; url: string }): boolean =>
  endpoint.id === SPIKE_ENDPOINT_ID || (endpoint.url.includes(':3001') && endpoint.url !== TARGET_WEBHOOK_URL);

/** Idempotent open-wearables setup. Logs ids only; secrets are written to env files and never printed. */
export const setupOpenWearables = async (options: SetupOptions): Promise<SetupReport> => {
  const fetch = options.fetch ?? defaultFetch;
  const readText = options.readText ?? ((path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  });
  const writeText = options.writeText ?? ((path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  });
  const log = options.log ?? ((line) => console.log(line));
  const client = createClient(options.baseUrl, fetch);
  const { email, password } = credentials(readText(options.openWearablesEnvPath), options.env);
  const token = await client.login(email, password);

  const keys = await client.listApiKeys(token);
  const deletedKeyIds: string[] = [];
  for (const key of keys.filter((item) => item.name === SPIKE_KEY_NAME)) {
    await client.deleteApiKey(token, key.id);
    deletedKeyIds.push(key.id);
  }
  const existingEnv = parseEnvFile(readText(options.apiEnvPath) ?? '');
  const apiKey = await ensureApiKey(client, token, existingEnv.OW_API_KEY);

  const deletedUserIds: string[] = [];
  if (await client.deleteUser(apiKey.key, SPIKE_USER_ID)) deletedUserIds.push(SPIKE_USER_ID);
  const namedSpikes = await client.listUsers(apiKey.key, { search: SPIKE_USER_NAME });
  for (const user of namedSpikes.filter((item) => displayName(item) === SPIKE_USER_NAME && item.id !== SPIKE_USER_ID)) {
    if (await client.deleteUser(apiKey.key, user.id)) deletedUserIds.push(user.id);
  }

  const jakubUserId = await ensureUser(client, apiKey.key, JAKUB_EXTERNAL_ID, 'jakub-live@example.com', 'Jakub', 'Live');
  const martaUserId = await ensureUser(client, apiKey.key, MARTA_EXTERNAL_ID, 'persona-founder@example.com', 'Marta', 'Founder');

  const endpoints = await client.listEndpoints(token);
  const deletedEndpointIds: string[] = [];
  for (const endpoint of endpoints.filter(isLeftoverEndpoint)) {
    await client.deleteEndpoint(token, endpoint.id);
    deletedEndpointIds.push(endpoint.id);
  }
  const remaining = endpoints.filter((endpoint) => !deletedEndpointIds.includes(endpoint.id));
  const current = remaining.find((endpoint) => endpoint.url === TARGET_WEBHOOK_URL);
  const webhookEndpointId = current?.id ?? (await client.createEndpoint(token)).id;
  if (current) await client.updateEndpoint(token, current.id);
  const webhookSecret = await client.endpointSecret(token, webhookEndpointId);

  const apiUpdates = {
    OW_BASE_URL: options.baseUrl,
    OW_API_KEY: apiKey.key,
    OW_USER_ID_JAKUB: jakubUserId,
    OW_USER_ID_MARTA: martaUserId,
    OW_WEBHOOK_SECRET: webhookSecret,
  };
  writeText(options.apiEnvPath, mergeEnvFile(readText(options.apiEnvPath) ?? '', apiUpdates));
  writeText(
    options.connectorEnvPath,
    mergeEnvFile(readText(options.connectorEnvPath) ?? '', {
      OW_BASE_URL: options.baseUrl,
      OW_API_KEY: apiKey.key,
      OW_USER_ID: jakubUserId,
    }),
  );

  log(`api key ${HEADROOM_KEY_NAME} ${apiKey.id}${apiKey.reused ? ' (reused)' : ''}`);
  log(`user ${JAKUB_EXTERNAL_ID} ${jakubUserId}`);
  log(`user ${MARTA_EXTERNAL_ID} ${martaUserId}`);
  log(`webhook ${webhookEndpointId}`);
  log(`deleted users: ${deletedUserIds.length}, keys: ${deletedKeyIds.length}, endpoints: ${deletedEndpointIds.length}`);
  log('written app/api/.env.local');
  log('written app/connector/.env');

  return { apiKeyId: apiKey.id, apiKeyReused: apiKey.reused, jakubUserId, martaUserId, webhookEndpointId, deletedUserIds, deletedKeyIds, deletedEndpointIds };
};

if (import.meta.main) {
  const apiRoot = resolve(import.meta.dir, '..');
  const env = loadEnvironment(resolve(apiRoot, '.env.local'), process.env);
  setupOpenWearables({
    baseUrl: env.OW_BASE_URL || 'http://localhost:8000',
    openWearablesEnvPath: resolve(apiRoot, '../../../open-wearables/backend/config/.env'),
    apiEnvPath: resolve(apiRoot, '.env.local'),
    connectorEnvPath: resolve(apiRoot, '../connector/.env'),
    env,
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
