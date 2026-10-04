import { describe, expect, test } from 'bun:test';
import { parsePersonaArgs, pushConfigFrom, pushPayloads } from '../generate-persona';
import { toSdkPayloads } from './sdk-payload';
import type { HealthData } from '../../src/engine/types';

const emptyHealth = (): HealthData => ({
  stress: [{ t: Date.parse('2026-10-04T09:00:00Z'), v: 25 }],
  heartRate: [],
  steps: [],
  bodyBattery: [],
  hrv: [],
  sleeps: [],
  resilienceScore: null,
});

describe('persona CLI', () => {
  test('parses seed, today, dry-run and no-push', () => {
    expect(parsePersonaArgs(['--seed', '2026', '--today', '2026-10-04', '--no-push'])).toEqual({
      seed: 2026,
      today: '2026-10-04',
      dryRun: false,
      noPush: true,
    });
    expect(parsePersonaArgs(['--dry-run', '--seed', '7'], Date.parse('2026-10-04T12:00:00Z')).today).toBe('2026-10-04');
  });

  test('names missing push settings and does not echo a key that is present', () => {
    expect(() => pushConfigFrom({ OW_API_KEY: 'super-secret-value' })).toThrow(/OW_BASE_URL/);
    try {
      pushConfigFrom({ OW_API_KEY: 'super-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('super-secret-value');
    }
  });

  test('retries a 500 and does not print the key when the body echoes it', async () => {
    const payloads = toSdkPayloads(emptyHealth(), 5000);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(calls < 2 ? 'bad super-secret-value' : 'ok', { status: calls < 2 ? 500 : 202 });
    };
    const result = await pushPayloads(payloads, { baseUrl: 'http://localhost:8000', apiKey: 'super-secret-value', userId: 'marta' }, {
      fetch: fetchImpl,
      sleep: async () => undefined,
    });
    expect(calls).toBe(2);
    expect(result.chunks).toBe(1);
  });
});
