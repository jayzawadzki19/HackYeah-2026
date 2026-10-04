import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';
import { unavailable } from '../common/problem';
import type { ForecastEngine, ForecastInput, ForecastResult } from './engine.port';

export type EngineSource = 'real' | 'placeholder';

export interface LoadedEngine {
  readonly engine: ForecastEngine;
  readonly source: EngineSource;
  /** Helper names the real module did not export. Empty when source is placeholder or the module is complete. */
  readonly gaps: readonly string[];
}

const HELPERS = ['meetingTrace', 'pendingCheckIns', 'reflectionMessage'] as const;

const engineUnavailable = () =>
  unavailable(
    'engine-unavailable',
    'Forecast engine unavailable',
    'The forecast engine is not ready yet. src/engine/index.ts does not export buildForecast.',
  );

/** Used until Track C1 publishes src/engine/index.ts. Reads fail with a 503 instead of invented numbers. */
export const placeholderEngine = (): ForecastEngine => ({
  buildForecast(_input: ForecastInput): ForecastResult {
    throw engineUnavailable();
  },
  meetingTrace: () => [],
  pendingCheckIns: () => [],
  reflectionMessage: () => 'Forecast engine is not ready yet.',
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Adapts a module shaped like the engine barrel. A missing buildForecast keeps the placeholder.
 * Missing helpers stay as no-ops so meeting detail and check-ins still respond.
 */
export const adaptEngine = (value: unknown): LoadedEngine => {
  if (!isRecord(value) || typeof value.buildForecast !== 'function') {
    return { engine: placeholderEngine(), source: 'placeholder', gaps: ['buildForecast'] };
  }
  const buildForecast = value.buildForecast as (input: ForecastInput) => ForecastResult;
  const gaps = HELPERS.filter((name) => typeof value[name] !== 'function');
  const placeholder = placeholderEngine();
  const engine: ForecastEngine = {
    buildForecast: (input) => buildForecast(input),
    meetingTrace:
      typeof value.meetingTrace === 'function'
        ? (value.meetingTrace as ForecastEngine['meetingTrace'])
        : placeholder.meetingTrace,
    pendingCheckIns:
      typeof value.pendingCheckIns === 'function'
        ? (value.pendingCheckIns as ForecastEngine['pendingCheckIns'])
        : placeholder.pendingCheckIns,
    reflectionMessage:
      typeof value.reflectionMessage === 'function'
        ? (value.reflectionMessage as ForecastEngine['reflectionMessage'])
        : placeholder.reflectionMessage,
  };
  return { engine, source: 'real', gaps };
};

/** Loads the pure engine when the other track has exported it; otherwise the placeholder. */
export const loadForecastEngine = async (
  indexPath = join(import.meta.dir, '../engine/index.ts'),
): Promise<LoadedEngine> => {
  if (!existsSync(indexPath)) return adaptEngine(undefined);
  try {
    const imported: unknown = await import(pathToFileURL(indexPath).href);
    const loaded = adaptEngine(imported);
    if (loaded.source === 'placeholder') {
      Logger.warn('src/engine/index.ts is present but does not export buildForecast; using the placeholder engine.', 'Engine');
    } else if (loaded.gaps.length > 0) {
      Logger.warn(`Forecast engine loaded with missing helpers: ${loaded.gaps.join(', ')}.`, 'Engine');
    }
    return loaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.warn(`Could not load src/engine/index.ts (${message}); using the placeholder engine.`, 'Engine');
    return adaptEngine(undefined);
  }
};
