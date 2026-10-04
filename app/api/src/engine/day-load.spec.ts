import { describe, expect, test } from 'bun:test';
import { dayLoad, dayOutlook, gapLevel } from './day-load';
import { ENGINE_CONFIG } from './engine.config';

const HAPPY_PATH_TOMORROW = [
  { load: 15, durationH: 0.25 },
  { load: 83, durationH: 2 },
  { load: 56, durationH: 0.5 },
  { load: 76, durationH: 1 },
  { load: 52, durationH: 0.5 },
];

describe('dayLoad', () => {
  test('reproduces the happy-path tomorrow: about 83 with the intervals, about 75 without', () => {
    expect(dayLoad(HAPPY_PATH_TOMORROW, [{ intensity: 'intervals' }], ENGINE_CONFIG)).toBe(83);
    expect(dayLoad(HAPPY_PATH_TOMORROW, [], ENGINE_CONFIG)).toBe(75);
  });

  test('an empty day has zero load', () => {
    expect(dayLoad([], [], ENGINE_CONFIG)).toBe(0);
  });

  test('a rest day with an easy run carries only the training load', () => {
    expect(dayLoad([], [{ intensity: 'easy' }], ENGINE_CONFIG)).toBe(2);
  });

  test('clamps at 100', () => {
    expect(dayLoad([{ load: 100, durationH: 9 }], [{ intensity: 'long' }], ENGINE_CONFIG)).toBe(100);
  });
});

describe('gapLevel', () => {
  test('red at 20 or more, amber from 8 to below 20, green below 8', () => {
    expect(gapLevel(29, ENGINE_CONFIG)).toBe('red');
    expect(gapLevel(20, ENGINE_CONFIG)).toBe('red');
    expect(gapLevel(19.9, ENGINE_CONFIG)).toBe('amber');
    expect(gapLevel(8, ENGINE_CONFIG)).toBe('amber');
    expect(gapLevel(7.9, ENGINE_CONFIG)).toBe('green');
    expect(gapLevel(-12, ENGINE_CONFIG)).toBe('green');
  });
});

describe('dayOutlook', () => {
  test('gap = day load - capacity, with its level', () => {
    expect(dayOutlook(83, 54, ENGINE_CONFIG)).toEqual({ capacity: 54, dayLoad: 83, gap: 29, gapLevel: 'red' });
  });

  test('gap and level are null when capacity is unknown', () => {
    expect(dayOutlook(40, null, ENGINE_CONFIG)).toEqual({ capacity: null, dayLoad: 40, gap: null, gapLevel: null });
  });
});
