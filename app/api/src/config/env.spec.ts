import { describe, expect, test } from 'bun:test';
import { ConfigError, parseEnv } from './env';

const API_ROOT = '/srv/headroom/app/api';

const validEnv = {
  OW_API_KEY: 'sk-test-key-0000000000',
  OW_USER_ID_JAKUB: '11111111-1111-4111-8111-111111111111',
  OW_USER_ID_MARTA: '22222222-2222-4222-8222-222222222222',
  OW_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQtdmFsdWU=',
} as const;

describe('parseEnv', () => {
  test('applies defaults and resolves paths against the api root', () => {
    const config = parseEnv(validEnv, API_ROOT);

    expect(config).toEqual({
      port: 3001,
      webOrigin: 'http://localhost:4200',
      openWearables: {
        baseUrl: 'http://localhost:8000',
        apiKey: validEnv.OW_API_KEY,
        webhookSecret: validEnv.OW_WEBHOOK_SECRET,
      },
      owUserIds: { jakub: validEnv.OW_USER_ID_JAKUB, marta: validEnv.OW_USER_ID_MARTA },
      connectorUrl: 'http://localhost:8787',
      ingestMode: 'webhook',
      dbPath: '/srv/headroom/app/api/data/local/headroom.sqlite',
      calendarDir: '/srv/headroom/app/api/data/calendars',
      llm: null,
    });
  });

  test('reads explicit values, keeping absolute paths and the in-memory database as-is', () => {
    const config = parseEnv(
      {
        ...validEnv,
        PORT: '4000',
        INGEST_MODE: 'poll',
        DB_PATH: ':memory:',
        CALENDAR_DIR: '/data/calendars',
        LLM_BASE_URL: 'http://localhost:11434/v1',
        LLM_API_KEY: 'llm-key',
        LLM_MODEL: 'small',
      },
      API_ROOT,
    );

    expect(config.port).toBe(4000);
    expect(config.ingestMode).toBe('poll');
    expect(config.dbPath).toBe(':memory:');
    expect(config.calendarDir).toBe('/data/calendars');
    expect(config.llm).toEqual({ baseUrl: 'http://localhost:11434/v1', apiKey: 'llm-key', model: 'small' });
  });

  test('lists every missing required variable in one readable error', () => {
    const run = () => parseEnv({}, API_ROOT);

    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/OW_API_KEY: is required/);
    expect(run).toThrow(/OW_USER_ID_JAKUB: is required/);
    expect(run).toThrow(/OW_USER_ID_MARTA: is required/);
    expect(run).toThrow(/OW_WEBHOOK_SECRET: is required/);
  });

  test('treats empty strings as missing', () => {
    expect(() => parseEnv({ ...validEnv, OW_API_KEY: '' }, API_ROOT)).toThrow(/OW_API_KEY: is required/);
  });

  test('rejects malformed values without echoing them', () => {
    const secret = 'not-a-svix-secret-value';
    const run = () => parseEnv({ ...validEnv, OW_WEBHOOK_SECRET: secret, INGEST_MODE: 'push' }, API_ROOT);

    expect(run).toThrow(/OW_WEBHOOK_SECRET: must start with whsec_/);
    expect(run).toThrow(/INGEST_MODE/);
    try {
      run();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
