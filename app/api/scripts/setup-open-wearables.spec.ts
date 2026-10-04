import { describe, expect, test } from 'bun:test';
import type { FetchFn } from '../src/common/http';
import { setupOpenWearables } from './setup-open-wearables';

const SPIKE_USER = 'dec167e8-efd9-4356-a7e7-b27bf8ab5c9f';
const SPIKE_ENDPOINT = 'ep_3KCsGBykvgKzQhKLFrmlXEdxgZm';
const API_KEY = 'ow_live_key_do_not_print';
const SECRET = 'whsec_endpoint_secret_do_not_print';
const PASSWORD = 'admin-password-do-not-print';

interface UserRow {
  id: string;
  external_user_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface EndpointRow {
  id: string;
  url: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const harness = (options?: { existingKey?: string; headroomExists?: boolean }) => {
  const files = new Map<string, string>();
  if (options?.existingKey) files.set('/api.env', `OW_API_KEY=${options.existingKey}\n`);
  const keys: { id: string; name: string }[] = [{ id: 'k-spike', name: 'headroom-spike' }];
  if (options?.headroomExists) keys.push({ id: 'k-headroom', name: 'headroom' });
  const users: UserRow[] = [
    { id: SPIKE_USER, external_user_id: 'spike', email: 'spike@example.com', first_name: 'Webhook', last_name: 'Spike' },
  ];
  const endpoints: EndpointRow[] = [
    { id: SPIKE_ENDPOINT, url: 'http://host.docker.internal:3001/spike' },
    { id: 'ep_local', url: 'http://127.0.0.1:3001/other' },
    { id: 'ep_keep', url: 'https://example.com/hook' },
  ];
  const calls: string[] = [];
  let rotated = false;
  const fetch: FetchFn = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/v1/auth/login') {
      const body = String(init?.body);
      if (!body.includes('username=admin%40example.com') || !body.includes(encodeURIComponent(PASSWORD))) {
        return json({ detail: 'nope' }, 401);
      }
      return json({ access_token: 'jwt-token', token_type: 'bearer' });
    }
    if (url.pathname === '/api/v1/developer/api-keys' && method === 'GET') return json(keys);
    if (url.pathname === '/api/v1/developer/api-keys' && method === 'POST') {
      keys.push({ id: 'k-created', name: 'headroom' });
      return json({ id: 'k-created', name: 'headroom', key: API_KEY }, 201);
    }
    if (url.pathname.endsWith('/rotate') && method === 'POST') {
      rotated = true;
      return json({ id: 'k-rotated', name: 'headroom', key: API_KEY }, 201);
    }
    if (url.pathname.startsWith('/api/v1/developer/api-keys/') && method === 'DELETE') {
      const id = url.pathname.split('/').at(-1);
      const index = keys.findIndex((key) => key.id === id);
      if (index >= 0) keys.splice(index, 1);
      return json({ id });
    }
    if (url.pathname === '/api/v1/users' && method === 'GET') {
      const externalId = url.searchParams.get('external_user_id');
      const email = url.searchParams.get('email');
      const search = url.searchParams.get('search');
      const items = users.filter((user) => {
        if (externalId) return user.external_user_id === externalId;
        if (email) return user.email === email;
        if (search) return `${user.first_name ?? ''} ${user.last_name ?? ''}`.includes(search);
        return true;
      });
      return json({ items, total: items.length, page: 1, limit: 100 });
    }
    if (url.pathname === '/api/v1/users' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as UserRow;
      const created = { ...body, id: body.external_user_id === 'jakub-live' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222' };
      users.push(created);
      return json(created, 201);
    }
    if (url.pathname.startsWith('/api/v1/users/') && method === 'DELETE') {
      const id = url.pathname.split('/').at(-1);
      const index = users.findIndex((user) => user.id === id);
      if (index < 0) return json({ detail: 'missing' }, 404);
      users.splice(index, 1);
      return json({ id });
    }
    if (url.pathname === '/api/v1/webhooks/endpoints' && method === 'GET') return json(endpoints);
    if (url.pathname === '/api/v1/webhooks/endpoints' && method === 'POST') {
      endpoints.push({ id: 'ep_new', url: 'http://host.docker.internal:3001/webhooks/open-wearables' });
      return json({ id: 'ep_new', url: 'http://host.docker.internal:3001/webhooks/open-wearables' }, 201);
    }
    if (url.pathname.endsWith('/secret')) return json({ key: SECRET });
    if (url.pathname.startsWith('/api/v1/webhooks/endpoints/') && method === 'DELETE') {
      const id = url.pathname.split('/').at(-1);
      const index = endpoints.findIndex((endpoint) => endpoint.id === id);
      if (index >= 0) endpoints.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/api/v1/webhooks/endpoints/') && method === 'PATCH') return json({ id: 'patched' });
    return json({ detail: 'not found' }, 404);
  };
  const logs: string[] = [];
  return {
    calls,
    files,
    logs,
    get rotated() {
      return rotated;
    },
    run: (envText = `ADMIN_EMAIL=admin@example.com\nADMIN_PASSWORD=${PASSWORD}\n`) =>
      setupOpenWearables({
        baseUrl: 'http://ow.test',
        openWearablesEnvPath: '/ow.env',
        apiEnvPath: '/api.env',
        connectorEnvPath: '/connector.env',
        env: {},
        fetch,
        readText: (path) => (path === '/ow.env' ? envText : (files.get(path) ?? null)),
        writeText: (path, text) => files.set(path, text),
        log: (line) => logs.push(line),
      }),
  };
};

describe('setupOpenWearables', () => {
  test('creates the key, users and webhook, deletes leftovers, and does not log secrets', async () => {
    const setup = harness();

    const report = await setup.run();

    expect(report).toMatchObject({
      apiKeyId: 'k-created',
      apiKeyReused: false,
      jakubUserId: '11111111-1111-4111-8111-111111111111',
      martaUserId: '22222222-2222-4222-8222-222222222222',
      webhookEndpointId: 'ep_new',
      deletedUserIds: [SPIKE_USER],
      deletedKeyIds: ['k-spike'],
    });
    expect(report.deletedEndpointIds).toEqual([SPIKE_ENDPOINT, 'ep_local']);
    expect(setup.calls).toContain('POST /api/v1/auth/login');
    expect(setup.calls).toContain('POST /api/v1/developer/api-keys');
    expect(setup.calls).toContain('POST /api/v1/users');
    const apiEnv = setup.files.get('/api.env') ?? '';
    const connectorEnv = setup.files.get('/connector.env') ?? '';
    expect(apiEnv).toContain(`OW_API_KEY=${API_KEY}`);
    expect(apiEnv).toContain('OW_USER_ID_JAKUB=11111111-1111-4111-8111-111111111111');
    expect(apiEnv).toContain('OW_USER_ID_MARTA=22222222-2222-4222-8222-222222222222');
    expect(apiEnv).toContain(`OW_WEBHOOK_SECRET=${SECRET}`);
    expect(connectorEnv).toContain(`OW_API_KEY=${API_KEY}`);
    expect(connectorEnv).toContain('OW_USER_ID=11111111-1111-4111-8111-111111111111');
    expect(connectorEnv).toContain('OW_BASE_URL=http://ow.test');
    const logged = setup.logs.join('\n');
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).toContain('written app/api/.env.local');
  });

  test('reuses a headroom key that is already in the api env file', async () => {
    const setup = harness({ headroomExists: true, existingKey: 'already-stored-key' });

    const report = await setup.run();

    expect(report.apiKeyReused).toBe(true);
    expect(report.apiKeyId).toBe('k-headroom');
    expect(setup.rotated).toBe(false);
    expect(setup.calls).not.toContain('POST /api/v1/developer/api-keys');
    expect(setup.files.get('/api.env')).toContain('OW_API_KEY=already-stored-key');
    expect(setup.logs.join('\n')).not.toContain('already-stored-key');
  });

  test('rotates the headroom key when the secret is not on disk', async () => {
    const setup = harness({ headroomExists: true });

    const report = await setup.run();

    expect(report.apiKeyReused).toBe(false);
    expect(report.apiKeyId).toBe('k-rotated');
    expect(setup.rotated).toBe(true);
    expect(setup.files.get('/connector.env')).toContain(`OW_API_KEY=${API_KEY}`);
  });
});
