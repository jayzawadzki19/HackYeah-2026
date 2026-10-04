import { z } from 'zod';
import type { UserKey } from '../../../contracts/api-contract';
import { defaultFetch, type FetchFn } from '../common/http';

export interface SyncResult {
  readonly pushedRecords: number;
  readonly latestSampleAt: string | null;
}

export interface ConnectorClient {
  sync(userKey: UserKey): Promise<SyncResult>;
}

export const CONNECTOR_CLIENT = Symbol('ConnectorClient');

/** Connector failures already phrased for the sync.status error event. */
export class ConnectorError extends Error {
  override readonly name = 'ConnectorError';

  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

const syncBody = z.object({
  pushedRecords: z.number().int().nonnegative(),
  latestSampleAt: z.string().nullable(),
});

const SYNC_TIMEOUT_MS = 60_000;

const detailOf = (text: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const detail = 'detail' in parsed ? parsed.detail : 'message' in parsed ? parsed.message : null;
    return typeof detail === 'string' && detail.trim() !== '' ? detail.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
};

const failureMessage = (status: number, text: string): string => {
  if (status === 409) return 'A sync is already running.';
  if (status === 503) return detailOf(text) ?? 'Garmin authentication failed. Run connector login and try again.';
  return detailOf(text) ?? `The connector returned ${status}.`;
};

const transportMessage = (error: unknown): string =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? 'The connector did not finish within 60 seconds.'
    : 'The connector is unreachable.';

/** `POST {CONNECTOR_URL}/sync?user=jakub`, 60s timeout. */
export class HttpConnectorClient implements ConnectorClient {
  constructor(
    private readonly connectorUrl: string,
    private readonly fetch: FetchFn = defaultFetch,
  ) {}

  async sync(userKey: UserKey): Promise<SyncResult> {
    const url = new URL('/sync', this.connectorUrl.endsWith('/') ? this.connectorUrl : `${this.connectorUrl}/`);
    url.searchParams.set('user', userKey);
    const response = await this.fetch(url, { method: 'POST', signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) }).catch(
      (error: unknown) => {
        throw new ConnectorError(null, transportMessage(error));
      },
    );
    const text = await response.text();
    if (!response.ok) throw new ConnectorError(response.status, failureMessage(response.status, text));
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text || 'null') as unknown;
    } catch {
      throw new ConnectorError(response.status, 'The connector returned an unexpected response.');
    }
    const parsed = syncBody.safeParse(parsedJson);
    if (!parsed.success) throw new ConnectorError(response.status, 'The connector returned an unexpected response.');
    return parsed.data;
  }
}
