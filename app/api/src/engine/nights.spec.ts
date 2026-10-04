import { describe, expect, test } from 'bun:test';
import { buildNights } from './nights';
import { at, everyMinutes, WARSAW } from './testing/builders';
import type { SleepSession } from './types';

const session = (date: string, startHm: string, endHm: string, asleepMin: number): SleepSession => ({
  start: at(date, startHm),
  end: at(date, endHm),
  asleepMin,
});

describe('buildNights', () => {
  test('keeps one night per local wake date, the longest session (naps never replace the night)', () => {
    const nights = buildNights([session('2026-10-04', '00:25', '06:30', 365), session('2026-10-04', '14:00', '14:30', 30)], [], WARSAW);
    expect(nights).toHaveLength(1);
    expect(nights[0]!.date).toBe('2026-10-04');
    expect(nights[0]!.session.asleepMin).toBe(365);
  });

  test('sorts nights by wake date', () => {
    const nights = buildNights([session('2026-10-04', '00:25', '06:30', 365), session('2026-10-02', '00:25', '06:30', 360)], [], WARSAW);
    expect(nights.map((n) => n.date)).toEqual(['2026-10-02', '2026-10-04']);
  });

  test('averages the HRV readings recorded inside the session only', () => {
    const hrv = [
      ...everyMinutes(at('2026-10-04', '01:00'), at('2026-10-04', '02:00'), 10, () => 50),
      ...everyMinutes(at('2026-10-04', '02:00'), at('2026-10-04', '03:00'), 10, () => 60),
      { t: at('2026-10-04', '12:00'), v: 200 },
    ];
    const [night] = buildNights([session('2026-10-04', '00:25', '06:30', 365)], hrv, WARSAW);
    expect(night!.hrvMean).toBe(55);
  });

  test('a night without HRV readings has a null HRV mean, not 0', () => {
    const [night] = buildNights([session('2026-10-04', '00:25', '06:30', 365)], [], WARSAW);
    expect(night!.hrvMean).toBeNull();
  });
});
