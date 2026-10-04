import { HttpErrorResponse } from '@angular/common/http';
import { toViewState } from './view-state';

const problem = new HttpErrorResponse({
  status: 503,
  error: { type: 'about:blank', title: 'Unavailable', status: 503, detail: 'open-wearables is unreachable' },
});

describe('toViewState', () => {
  it('is loading while the first value is on its way', () => {
    expect(toViewState({ status: 'loading', value: undefined }, undefined)).toEqual({ kind: 'loading' });
    expect(toViewState({ status: 'idle', value: undefined }, undefined)).toEqual({ kind: 'loading' });
  });

  it('is ready with a resolved value', () => {
    expect(toViewState({ status: 'resolved', value: 1 }, 1)).toEqual({ kind: 'ready', value: 1, refreshing: false, refreshError: null });
  });

  it('keeps showing the value while it reloads', () => {
    expect(toViewState({ status: 'reloading', value: 1 }, 1)).toEqual({ kind: 'ready', value: 1, refreshing: true, refreshError: null });
  });

  it('shows the problem detail when nothing was loaded yet', () => {
    expect(toViewState({ status: 'error', error: problem }, undefined)).toEqual({ kind: 'error', detail: 'open-wearables is unreachable' });
  });

  it('keeps the last good value when a refresh fails, instead of an error page', () => {
    expect(toViewState({ status: 'error', error: problem }, 7)).toEqual({
      kind: 'ready',
      value: 7,
      refreshing: false,
      refreshError: 'open-wearables is unreachable',
    });
  });

  it('shows locally updated values', () => {
    expect(toViewState({ status: 'local', value: 2 }, 2)).toMatchObject({ kind: 'ready', value: 2 });
  });
});
