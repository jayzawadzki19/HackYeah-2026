import { describe, expect, test } from 'bun:test';
import { ProblemException } from '../common/problem';
import { adaptEngine, loadForecastEngine, placeholderEngine } from './engine.factory';

describe('adaptEngine', () => {
  test('keeps the placeholder when buildForecast is missing', () => {
    const loaded = adaptEngine({ meetingTrace() { return []; } });

    expect(loaded.source).toBe('placeholder');
    expect(() => loaded.engine.buildForecast({} as never)).toThrow(ProblemException);
  });

  test('uses buildForecast from the module and fills missing helpers', () => {
    const loaded = adaptEngine({
      buildForecast: () => ({ headline: 'from the engine' }),
    });

    expect(loaded.source).toBe('real');
    expect(loaded.gaps).toEqual(['meetingTrace', 'pendingCheckIns', 'reflectionMessage']);
    expect(loaded.engine.buildForecast({} as never)).toMatchObject({ headline: 'from the engine' });
    expect(loaded.engine.meetingTrace({} as never, {} as never, {} as never, 'Europe/Warsaw')).toEqual([]);
    expect(loaded.engine.reflectionMessage(1, undefined)).toBe('Forecast engine is not ready yet.');
  });

  test('placeholder buildForecast is a 503 problem', () => {
    const error = (() => {
      try {
        placeholderEngine().buildForecast({} as never);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 503, type: '/problems/engine-unavailable' });
  });
});

describe('loadForecastEngine', () => {
  test('returns an engine whether or not the barrel exists', async () => {
    const loaded = await loadForecastEngine();

    expect(['real', 'placeholder']).toContain(loaded.source);
    expect(typeof loaded.engine.buildForecast).toBe('function');
  });
});
