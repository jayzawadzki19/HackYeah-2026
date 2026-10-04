import type { FetchFn } from '../../src/common/http';

export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
  readonly signal: AbortSignal | null;
}

export type FakeHandler = (request: RecordedRequest, index: number) => Response | Promise<Response>;

/** A scripted fetch that records every request; the handler decides each response. */
export const fakeFetch = (handler: FakeHandler) => {
  const calls: RecordedRequest[] = [];
  const fetch: FetchFn = async (url, init = {}) => {
    const request: RecordedRequest = {
      url: new URL(url),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null,
      signal: init.signal ?? null,
    };
    calls.push(request);
    return handler(request, calls.length - 1);
  };
  return { calls, fetch };
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Never resolves until the request's signal aborts, like a real hung connection. */
export const hang = (request: RecordedRequest): Promise<Response> =>
  new Promise((_, reject) => {
    request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
  });
