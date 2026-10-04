import { computed, effect, type Resource, type Signal, signal } from '@angular/core';
import { toViewState, type ViewState } from './view-state';

/** Keeps the last good value so a failed refresh never replaces the screen with an error. */
export const remembered = <T>(resource: Resource<T | undefined>): Signal<ViewState<T>> => {
  const last = signal<T | undefined>(undefined);
  effect(() => {
    if (!resource.hasValue()) return;
    const value = resource.value();
    if (value !== undefined) last.set(value);
  });
  return computed(() =>
    toViewState(
      {
        status: resource.status(),
        value: resource.hasValue() ? resource.value() : undefined,
        error: resource.error(),
      },
      last(),
    ),
  );
};
