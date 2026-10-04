export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchFn = (url, init) => fetch(url, init);

export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
