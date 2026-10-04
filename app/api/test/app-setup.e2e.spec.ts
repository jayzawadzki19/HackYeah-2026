import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Body, Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { configureApp } from '../src/app.setup';
import { ProblemException } from '../src/common/problem';
import { testConfig } from './support/test-config';

const bodySchema = z.object({ rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

@Controller('probe')
class ProbeController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Meeting m-1 not found.');
  }

  @Get('problem')
  problem(): never {
    throw new ProblemException({ type: '/problems/custom', title: 'Custom', status: 409, detail: 'Custom detail.' });
  }

  @Get('crash')
  crash(): never {
    throw new Error('database password is hunter2');
  }

  @Get('domain')
  domain(): never {
    throw Object.assign(new Error('calendar missing'), {
      toProblem: () => ({ type: '/problems/domain', title: 'Domain', status: 503, detail: 'Domain detail.' }),
    });
  }

  @Post('body')
  @HttpCode(201)
  body(@Body({ schema: bodySchema }) body: z.infer<typeof bodySchema>) {
    return body;
  }
}

@Controller('webhooks')
class WebhookProbeController {
  @Post('open-wearables')
  @HttpCode(204)
  receive(): void {}
}

describe('configureApp', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController, WebhookProbeController] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false }), testConfig());
    await app.init();
  });

  afterAll(() => app.close());

  test('maps HttpExceptions to problem details', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/not-found').expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Meeting m-1 not found.' });
  });

  test('passes ProblemException bodies through unchanged', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/problem').expect(409);

    expect(response.body).toEqual({ type: '/problems/custom', title: 'Custom', status: 409, detail: 'Custom detail.' });
  });

  test('lets domain errors describe their own problem', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/domain').expect(503);

    expect(response.body).toEqual({ type: '/problems/domain', title: 'Domain', status: 503, detail: 'Domain detail.' });
  });

  test('hides unexpected error messages behind a generic 500 problem', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/crash').expect(500);

    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Unexpected server error.',
    });
  });

  test('validates bodies with zod schemas and reports the failing field', async () => {
    const response = await request(app.getHttpServer()).post('/api/probe/body').send({ rating: 5 }).expect(400);

    expect(response.body).toMatchObject({ type: '/problems/invalid-request', title: 'Invalid request', status: 400 });
    expect(response.body.detail).toContain('rating');
  });

  test('returns the parsed body when it is valid', async () => {
    await request(app.getHttpServer()).post('/api/probe/body').send({ rating: -1 }).expect(201, { rating: -1 });
  });

  test('reports malformed JSON as a 400 problem', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe/body')
      .set('content-type', 'application/json')
      .send('{"rating":')
      .expect(400);

    expect(response.body).toMatchObject({ title: 'Bad Request', status: 400 });
  });

  test('answers unknown routes with a 404 problem', async () => {
    const response = await request(app.getHttpServer()).get('/api/nope').expect(404);

    expect(response.body).toMatchObject({ type: 'about:blank', title: 'Not Found', status: 404 });
  });

  test('serves webhooks without the /api prefix', async () => {
    await request(app.getHttpServer()).post('/webhooks/open-wearables').expect(204);
    await request(app.getHttpServer()).post('/api/webhooks/open-wearables').expect(404);
  });

  test('allows CORS only for the web origin', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/probe/not-found').set('Origin', 'http://localhost:4200');
    const denied = await request(app.getHttpServer()).get('/api/probe/not-found').set('Origin', 'http://evil.test');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
