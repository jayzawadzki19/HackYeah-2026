import { Injectable, inject, signal, DestroyRef } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Clock {
  readonly now = signal(Date.now());

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
