import { problemDetail } from '../api/problem';

export type ViewState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly detail: string }
  | { readonly kind: 'ready'; readonly value: T; readonly refreshing: boolean; readonly refreshError: string | null };

export const toViewState = <T>(
  snapshot: { readonly status: string; readonly value?: T; readonly error?: unknown },
  lastGood: T | undefined,
): ViewState<T> => {
  if (snapshot.status === 'error') {
    const detail = problemDetail(snapshot.error);
    if (lastGood !== undefined) return { kind: 'ready', value: lastGood, refreshing: false, refreshError: detail };
    return { kind: 'error', detail };
  }

  if ((snapshot.status === 'resolved' || snapshot.status === 'reloading' || snapshot.status === 'local') && snapshot.value !== undefined) {
    return { kind: 'ready', value: snapshot.value, refreshing: snapshot.status === 'reloading', refreshError: null };
  }

  return { kind: 'loading' };
};
