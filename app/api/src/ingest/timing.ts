export const DEBOUNCE_MS = 3_000;
export const POLL_EVERY_MS = 2_000;
export const POLL_FOR_MS = 60_000;
export const BACKGROUND_EVERY_MS = 60_000;

export interface DelayHandle {
  cancel(): void;
}

/** Schedules work later. Tests supply a manual implementation so debounce does not sleep. */
export interface Delayer {
  delay(ms: number, fn: () => void): DelayHandle;
}

export const DELAYER = Symbol('Delayer');

export const timeoutDelayer: Delayer = {
  delay(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  },
};

/** Probes until a sample is newer than the cursor, or the 60s window ends. */
export const pollUntilNewer = async (probe: () => Promise<boolean>, sleep: (ms: number) => Promise<void>): Promise<boolean> => {
  const pauses = POLL_FOR_MS / POLL_EVERY_MS;
  for (let attempt = 0; attempt <= pauses; attempt += 1) {
    if (await probe()) return true;
    if (attempt === pauses) return false;
    await sleep(POLL_EVERY_MS);
  }
  return false;
};
