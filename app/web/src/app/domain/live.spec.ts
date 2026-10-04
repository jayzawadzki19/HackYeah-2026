import type { LivePointDto } from '@contracts';
import { liveReadout } from './live';

const point = (t: string, stress: number | null, heartRate: number | null): LivePointDto => ({ t, stress, heartRate });

describe('liveReadout', () => {
  it('reads stress and heart rate from the latest sample', () => {
    const readout = liveReadout([point('2026-10-04T10:00:00Z', 30, 70), point('2026-10-04T10:02:00Z', 46, 88)]);

    expect(readout).toMatchObject({ at: '2026-10-04T10:02:00Z', signal: 'stress', text: 'Right now: stress 46 / heart rate 88' });
  });

  it('falls back to heart rate when stress is not measurable', () => {
    const readout = liveReadout([point('2026-10-04T10:00:00Z', 30, 70), point('2026-10-04T10:02:00Z', null, 97)]);

    expect(readout).toMatchObject({ signal: 'hr', stress: null, heartRate: 97, text: 'Right now: heart rate 97' });
  });

  it('skips trailing samples without any value', () => {
    const readout = liveReadout([point('2026-10-04T10:00:00Z', 31, 71), point('2026-10-04T10:02:00Z', null, null)]);

    expect(readout?.at).toBe('2026-10-04T10:00:00Z');
  });

  it('shows stress alone when heart rate is missing', () => {
    expect(liveReadout([point('2026-10-04T10:00:00Z', 40, null)])?.text).toBe('Right now: stress 40');
  });

  it('has nothing to say without samples', () => {
    expect(liveReadout([])).toBeNull();
    expect(liveReadout([point('2026-10-04T10:00:00Z', null, null)])).toBeNull();
  });
});
