import { describe, expect, test } from 'bun:test';
import { buildForecast, ENGINE_CONFIG, meetingTrace, pendingCheckIns, recommendActions, reflectionMessage } from './index';

describe('engine barrel', () => {
  test('exports the forecast entry points and the parameter table', () => {
    expect(typeof buildForecast).toBe('function');
    expect(typeof meetingTrace).toBe('function');
    expect(typeof pendingCheckIns).toBe('function');
    expect(typeof reflectionMessage).toBe('function');
    expect(typeof recommendActions).toBe('function');
    expect(ENGINE_CONFIG.HISTORY_DAYS).toBe(42);
    expect(ENGINE_CONFIG.HEAVY_DAY_LOAD).toBe(70);
  });
});
