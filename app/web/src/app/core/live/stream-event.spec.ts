import { parseStreamEvent, reconnectDelay } from './stream-event';

describe('reconnectDelay', () => {
  it('backs off exponentially from one second', () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('caps the delay at 30 seconds', () => {
    expect(reconnectDelay(5)).toBe(30000);
    expect(reconnectDelay(40)).toBe(30000);
  });
});

describe('parseStreamEvent', () => {
  it('parses a sync status event', () => {
    const data = JSON.stringify({ type: 'sync.status', state: 'ok', pushedRecords: 214, at: '2026-10-04T10:00:00Z' });

    expect(parseStreamEvent(data)).toEqual({ type: 'sync.status', state: 'ok', pushedRecords: 214, at: '2026-10-04T10:00:00Z' });
  });

  it('parses a forecast update', () => {
    expect(parseStreamEvent('{"type":"forecast.updated","computedAt":"2026-10-04T10:00:00Z"}')).toEqual({
      type: 'forecast.updated',
      computedAt: '2026-10-04T10:00:00Z',
    });
  });

  it.each(['', 'not json', '42', '{"type":"other"}', '{"type":"sync.status","state":"weird","at":"x"}', '{"type":"forecast.updated"}'])(
    'ignores malformed data %s',
    data => {
      expect(parseStreamEvent(data)).toBeNull();
    },
  );
});
