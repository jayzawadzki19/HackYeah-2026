import type { AppConfig } from '../../src/config/env';

export const TEST_OW_USER_IDS = {
  jakub: '11111111-1111-4111-8111-111111111111',
  marta: '22222222-2222-4222-8222-222222222222',
} as const;

export const TEST_WEBHOOK_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  port: 0,
  webOrigin: 'http://localhost:4200',
  openWearables: { baseUrl: 'http://ow.test', apiKey: 'sk-test', webhookSecret: TEST_WEBHOOK_SECRET },
  owUserIds: TEST_OW_USER_IDS,
  connectorUrl: 'http://connector.test',
  ingestMode: 'webhook',
  dbPath: ':memory:',
  calendarDir: '/nonexistent',
  llm: null,
  ...overrides,
});
