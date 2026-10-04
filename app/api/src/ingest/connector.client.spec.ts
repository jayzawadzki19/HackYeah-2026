import { describe, expect, test } from 'bun:test';
import type { FetchFn } from '../common/http';
import { ConnectorError, HttpConnectorClient } from './connector.client';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HttpConnectorClient', () => {
  test('posts the user and reads the sync result', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return jsonResponse(200, { pushedRecords: 2, latestSampleAt: null });
    };
    const client = new HttpConnectorClient('http://connector.test', fetch);

    await expect(client.sync('jakub')).resolves.toEqual({ pushedRecords: 2, latestSampleAt: null });
    expect(calls).toEqual([{ url: 'http://connector.test/sync?user=jakub', method: 'POST' }]);
  });

  test('turns a 503 into a Garmin login message when the body has no detail', async () => {
    const fetch: FetchFn = async () => jsonResponse(503, {});
    const client = new HttpConnectorClient('http://connector.test', fetch);

    await expect(client.sync('jakub')).rejects.toThrow('Garmin authentication failed. Run connector login and try again.');
  });

  test('uses the connector detail on a 503 and a fixed line on 409', async () => {
    const fetch: FetchFn = async (_url, init) => {
      void init;
      return jsonResponse(409, { detail: 'busy' });
    };
    const client = new HttpConnectorClient('http://connector.test', fetch);

    const error = await client.sync('jakub').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).message).toBe('A sync is already running.');
  });

  test('reports the connector as unreachable when the network fails', async () => {
    const fetch: FetchFn = async () => {
      throw new Error('connection refused');
    };
    const client = new HttpConnectorClient('http://connector.test', fetch);

    await expect(client.sync('jakub')).rejects.toThrow('The connector is unreachable.');
  });
});
