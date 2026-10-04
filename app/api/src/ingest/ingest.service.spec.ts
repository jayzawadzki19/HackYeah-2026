import { afterEach, describe, expect, test } from 'bun:test';
import { Webhook } from 'svix';
import { ProblemException } from '../common/problem';
import { testConfig, TEST_OW_USER_IDS, TEST_WEBHOOK_SECRET } from '../../test/support/test-config';
import { forecastStack, type ForecastStack } from '../../test/support/forecast-stack';
import { FakeConnector, FakeProbe, ManualDelayer } from '../../test/support/ingest-fakes';
import { ConnectorError } from './connector.client';
import { IngestService } from './ingest.service';
import type { StreamEventDto } from '../../../contracts/api-contract';

const signed = (payload: unknown, id = 'msg_1') => {
  const body = JSON.stringify(payload);
  const timestamp = new Date();
  const signature = new Webhook(TEST_WEBHOOK_SECRET).sign(id, timestamp, body);
  return {
    body: Buffer.from(body),
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
  };
};

const payloadFor = (userId: string) => ({ type: 'series.heart_rate.created', data: { user_id: userId } });

describe('IngestService', () => {
  let stack!: ForecastStack;
  let connector!: FakeConnector;
  let probe!: FakeProbe;
  let delayer!: ManualDelayer;
  let ingest!: IngestService;
  let events!: StreamEventDto[];

  afterEach(async () => {
    ingest?.onModuleDestroy();
    await ingest?.idle();
    await stack?.close();
  });

  const start = (ingestMode: 'webhook' | 'poll' = 'webhook') => {
    stack = forecastStack();
    connector = new FakeConnector();
    probe = new FakeProbe();
    delayer = new ManualDelayer();
    events = [];
    ingest = new IngestService(
      testConfig({ ingestMode }),
      stack.calendar,
      connector,
      probe,
      stack.clock,
      delayer,
      async (ms) => {
        stack.clock.advance(ms);
      },
      stack.deliveries,
      stack.forecasts,
      stack.bus,
      stack.syncStatus,
    );
    stack.bus.events('jakub').subscribe((event) => events.push(event));
  };

  test('rejects a bad signature and does not schedule a recompute', () => {
    start();
    const { body, headers } = signed(payloadFor(TEST_OW_USER_IDS.jakub));

    expect(() => ingest.receive(body, { ...headers, 'svix-signature': 'v1,aaaa' })).toThrow(ProblemException);
    expect(delayer.pending()).toBe(0);
  });

  test('dedupes a delivery and recomputes once, 3 seconds after the latest event', async () => {
    start();
    const first = signed(payloadFor(TEST_OW_USER_IDS.jakub), 'msg_a');
    const second = signed(payloadFor(TEST_OW_USER_IDS.jakub), 'msg_b');

    ingest.receive(first.body, first.headers);
    ingest.receive(second.body, second.headers);
    ingest.receive(second.body, second.headers);

    expect(delayer.pending()).toBe(1);
    expect(stack.engine.inputs).toHaveLength(0);
    delayer.flush();
    await stack.forecasts.idle();

    expect(stack.engine.inputs).toHaveLength(1);
    expect(stack.syncStatus.lastSyncAt('jakub')).toBe(stack.clock.now());
  });

  test('ignores a verified webhook for an unknown open-wearables user', () => {
    start();
    const delivery = signed(payloadFor('33333333-3333-4333-8333-333333333333'), 'msg_unknown');

    expect(() => ingest.receive(delivery.body, delivery.headers)).not.toThrow();
    expect(delayer.pending()).toBe(0);
  });

  test('publishes running then ok for a live sync', async () => {
    start();

    await ingest.runSync('jakub');

    expect(connector.calls).toEqual(['jakub']);
    expect(events).toEqual([
      { type: 'sync.status', state: 'running', at: '2026-10-04T11:00:00+02:00' },
      {
        type: 'sync.status',
        state: 'ok',
        pushedRecords: 4,
        latestSampleAt: '2026-10-04T10:58:00+02:00',
        at: '2026-10-04T11:00:00+02:00',
      },
    ]);
  });

  test('publishes a human error when the connector fails', async () => {
    start();
    connector.error = new ConnectorError(null, 'The connector is unreachable.');

    await ingest.runSync('jakub');

    expect(events.at(-1)).toMatchObject({ type: 'sync.status', state: 'error', error: 'The connector is unreachable.' });
  });

  test('refuses sync now for a synthetic user', async () => {
    start();
    const error = await ingest.requestSync('marta').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 409, type: '/problems/synthetic-sync' });
    expect(connector.calls).toEqual([]);
  });

  test('returns accepted before the connector finishes', async () => {
    start();
    connector.gate = { promise: new Promise(() => {}), resolve() {}, reject() {} };
    const { deferred } = await import('../../test/support/fakes');
    const gate = deferred<void>();
    connector.gate = gate;

    const accepted = await ingest.requestSync('jakub');

    expect(accepted).toEqual({ accepted: true });
    expect(events.some((event) => event.type === 'sync.status' && event.state === 'ok')).toBe(false);
    gate.resolve();
    await ingest.idle();
    expect(events.map((event) => (event.type === 'sync.status' ? event.state : event.type))).toEqual(['running', 'ok']);
  });

  test('in poll mode recomputes once a newer sample shows up', async () => {
    start('poll');
    probe.answers = [false, true];

    await ingest.runSync('jakub');

    expect(probe.calls).toHaveLength(2);
    expect(probe.calls[0]?.latestSampleAt).toBe('2026-10-04T10:58:00+02:00');
    expect(stack.engine.inputs).toHaveLength(1);
    expect(stack.clock.now()).toBe(Date.parse('2026-10-04T11:00:00+02:00') + 2_000);
  });

  test('in poll mode still recomputes when no newer sample arrives', async () => {
    start('poll');

    await ingest.runSync('jakub');

    expect(probe.calls.length).toBe(31);
    expect(stack.engine.inputs).toHaveLength(1);
  });

  test('background refresh recomputes live users only', async () => {
    start('poll');

    await ingest.refreshLiveUsers();

    expect(stack.engine.inputs.map((input) => input.timeZone)).toEqual(['Europe/Warsaw']);
    expect(stack.forecasts).toBeDefined();
    const keys = stack.engine.inputs.length;
    expect(keys).toBe(1);
  });
});
