export interface Environment {
  /** Serve typed fixtures from `src/testing` instead of calling the api on :3001 */
  readonly mockApi: boolean;
  /** Artificial latency of the mock api, so loading states stay visible during development */
  readonly mockLatencyMs: number;
}
