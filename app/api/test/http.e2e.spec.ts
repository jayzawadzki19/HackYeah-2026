import 'reflect-metadata';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Webhook } from 'svix';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CALENDAR_PROVIDER } from '../src/calendar/calendar.provider';
import { CLOCK } from '../src/common/clock';
import { FORECAST_ENGINE } from '../src/forecast/engine.port';
import { ForecastService } from '../src/forecast/forecast.service';
import { CONNECTOR_CLIENT } from '../src/ingest/connector.client';
import { DELAYER } from '../src/ingest/timing';
import { IngestService } from '../src/ingest/ingest.service';
import { HEALTH_SOURCE } from '../src/open-wearables/health.repository';
import { StreamBus } from '../src/stream/stream.bus';
import { SLEEP_ACTION } from './support/forecast-fixture';
import { at } from './support/forecast-fixture';
import { calendarFixture } from './support/calendar-fixture';
import { FakeCalendar, FakeClock, FakeEngine, FakeHealthSource } from './support/fakes';
import { FakeConnector, ManualDelayer } from './support/ingest-fakes';
import { TEST_OW_USER_IDS, TEST_WEBHOOK_SECRET, testConfig } from './support/test-config';
import type { StreamEventDto } from '../../contracts/api-contract';

const sign = (payload: unknown, id: string) => {
  const body = JSON.stringify(payload);
  const timestamp = new Date();
  return {
    body,
    id,
    timestamp: String(Math.floor(timestamp.getTime() / 1000)),
    signature: new Webhook(TEST_WEBHOOK_SECRET).sign(id, timestamp, body),
  };
};

describe('HTTP api', () => {
  let app: NestExpressApplication;
  const engine = new FakeEngine();
  const clock = new FakeClock(at('2026-10-04T11:00:00+02:00'));
  const calendar = new FakeCalendar({
    jakub: calendarFixture(),
    marta: calendarFixture({ userKey: 'marta', displayName: 'Marta', isSynthetic: true }),
  });
  const connector = new FakeConnector();
  const delayer = new ManualDelayer();
  const events: StreamEventDto[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(testConfig(), engine)],
    })
      .overrideProvider(CALENDAR_PROVIDER)
      .useValue(calendar)
      .overrideProvider(HEALTH_SOURCE)
      .useValue(new FakeHealthSource())
      .overrideProvider(FORECAST_ENGINE)
      .useValue(engine)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(CONNECTOR_CLIENT)
      .useValue(connector)
      .overrideProvider(DELAYER)
      .useValue(delayer)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
    configureApp(app, testConfig());
    await app.init();
    app.get(StreamBus).events('jakub').subscribe((event) => events.push(event));
  });

  afterAll(async () => {
    await app.get(IngestService).idle();
    await app.close();
  });

  test('GET /api/users lists both accounts', async () => {
    const response = await request(app.getHttpServer()).get('/api/users').expect(200);

    expect(response.body).toEqual([
      { key: 'jakub', displayName: 'Jakub', isSynthetic: false, live: true, timeZone: 'Europe/Warsaw' },
      { key: 'marta', displayName: 'Marta', isSynthetic: true, live: false, timeZone: 'Europe/Warsaw' },
    ]);
  });

  test('GET briefing is served from the forecast', async () => {
    const response = await request(app.getHttpServer()).get('/api/users/marta/briefing').expect(200);

    expect(response.body).toMatchObject({ headline: 'Tomorrow is your heaviest day in 6 weeks.', stale: false, user: { key: 'marta' } });
  });

  test('unknown user is a 404 problem', async () => {
    const response = await request(app.getHttpServer()).get('/api/users/ada/week').expect(404);

    expect(response.body).toMatchObject({ type: '/problems/unknown-user', status: 404 });
  });

  test('POST reflection validates the rating and returns 201', async () => {
    await request(app.getHttpServer()).post('/api/users/jakub/meetings/m-rehearsal/reflection').send({ rating: 2 }).expect(400);
    const response = await request(app.getHttpServer())
      .post('/api/users/jakub/meetings/m-rehearsal/reflection')
      .send({ rating: 1 })
      .expect(201);

    expect(response.body).toMatchObject({ meetingId: 'm-rehearsal', rating: 1 });
  });

  test('POST accept is 404 for an unknown action and 201 for a known one', async () => {
    await request(app.getHttpServer()).post('/api/users/jakub/actions/missing/accept').expect(404);
    const response = await request(app.getHttpServer()).post(`/api/users/jakub/actions/${SLEEP_ACTION.id}/accept`).expect(201);

    expect(response.body).toMatchObject({ actionId: SLEEP_ACTION.id });
    expect(response.body.block).toMatchObject({ forDate: '2026-10-05' });
  });

  test('sync now is 409 for a persona and 202 for a live user', async () => {
    const denied = await request(app.getHttpServer()).post('/api/users/marta/sync-now').expect(409);
    expect(denied.body).toMatchObject({ type: '/problems/synthetic-sync', status: 409 });

    await request(app.getHttpServer()).post('/api/users/jakub/sync-now').expect(202, { accepted: true });
    await app.get(IngestService).idle();
    expect(events.some((event) => event.type === 'sync.status' && event.state === 'ok')).toBe(true);
  });

  test('webhook signature, duplicate delivery and debounce', async () => {
    const bad = sign({ type: 'series.heart_rate.created', data: { user_id: TEST_OW_USER_IDS.jakub } }, 'msg_bad');
    const invalid = await request(app.getHttpServer())
      .post('/webhooks/open-wearables')
      .set('content-type', 'application/json')
      .set('svix-id', bad.id)
      .set('svix-timestamp', bad.timestamp)
      .set('svix-signature', 'v1,not-a-signature')
      .send(bad.body)
      .expect(400);
    expect(invalid.body).toMatchObject({ type: '/problems/invalid-request', status: 400 });

    const good = sign({ type: 'series.heart_rate.created', data: { user_id: TEST_OW_USER_IDS.jakub } }, 'msg_good');
    const post = () =>
      request(app.getHttpServer())
        .post('/webhooks/open-wearables')
        .set('content-type', 'application/json')
        .set('svix-id', good.id)
        .set('svix-timestamp', good.timestamp)
        .set('svix-signature', good.signature)
        .send(good.body);
    await post().expect(204);
    await post().expect(204);
    await request(app.getHttpServer()).post('/api/webhooks/open-wearables').send({}).expect(404);
    const before = engine.inputs.length;
    expect(delayer.pending()).toBe(1);
    delayer.flush();
    await app.get(ForecastService).idle();
    expect(engine.inputs.length).toBe(before + 1);
  });

  test('SSE names the event and writes the payload as data', async () => {
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/users/jakub/stream`, (res) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          const text = Buffer.concat(chunks).toString('utf8');
          if (text.includes('forecast.updated')) {
            req.destroy();
            resolve(text);
          }
        });
        app.get(StreamBus).publish('jakub', { type: 'forecast.updated', computedAt: '2026-10-04T11:00:00+02:00' });
      });
      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') return;
        reject(error);
      });
    });

    expect(body).toContain('event: forecast.updated');
    expect(body).toContain('"computedAt":"2026-10-04T11:00:00+02:00"');
  });
});
