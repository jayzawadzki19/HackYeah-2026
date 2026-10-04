import { describe, expect, test } from 'bun:test';
import { firstValueFrom, take, toArray } from 'rxjs';
import type { StreamEventDto } from '../../../contracts/api-contract';
import { StreamBus } from './stream.bus';

const updated = (computedAt: string): StreamEventDto => ({ type: 'forecast.updated', computedAt });

describe('StreamBus', () => {
  test('delivers events only to subscribers of that user', async () => {
    const bus = new StreamBus();
    const jakub = firstValueFrom(bus.events('jakub').pipe(take(2), toArray()));

    bus.publish('marta', updated('m'));
    bus.publish('jakub', updated('j1'));
    bus.publish('jakub', updated('j2'));

    expect(await jakub).toEqual([updated('j1'), updated('j2')]);
  });

  test('completes open streams on shutdown', async () => {
    const bus = new StreamBus();
    const received = firstValueFrom(bus.events('jakub').pipe(toArray()));

    bus.publish('jakub', updated('j1'));
    bus.onModuleDestroy();

    expect(await received).toEqual([updated('j1')]);
  });
});
