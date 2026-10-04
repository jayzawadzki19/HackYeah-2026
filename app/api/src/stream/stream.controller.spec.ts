import { describe, expect, test } from 'bun:test';
import { of } from 'rxjs';
import { ProblemException } from '../common/problem';
import { calendarFixture } from '../../test/support/calendar-fixture';
import { FakeCalendar } from '../../test/support/fakes';
import { UsersService } from '../users/users.service';
import { StreamBus } from './stream.bus';
import { StreamController } from './stream.controller';

describe('StreamController', () => {
  const calendar = new FakeCalendar({ jakub: calendarFixture() });
  const users = new UsersService(calendar);
  const bus = new StreamBus();
  const controller = new StreamController(users, bus, 15_000, () => of({ comment: 'ping' }));

  test('emits a heartbeat comment and named forecast events', async () => {
    const stream = await controller.stream('jakub');
    const received: { type?: string; comment?: string; data?: unknown }[] = [];
    const subscription = stream.subscribe((event) => received.push(event));
    bus.publish('jakub', { type: 'forecast.updated', computedAt: '2026-10-04T11:00:00+02:00' });
    subscription.unsubscribe();

    expect(received).toEqual([
      { comment: 'ping' },
      { type: 'forecast.updated', data: { type: 'forecast.updated', computedAt: '2026-10-04T11:00:00+02:00' } },
    ]);
  });

  test('rejects an unknown user before opening the stream', async () => {
    await expect(controller.stream('ada')).rejects.toBeInstanceOf(ProblemException);
  });
});
