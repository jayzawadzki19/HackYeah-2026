import { Injectable, signal } from '@angular/core';

interface Toast {
  readonly id: number;
  readonly text: string;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<readonly Toast[]>([]);
  private seq = 0;

  push(text: string): void {
    const id = ++this.seq;
    this.items.update(items => [...items, { id, text }]);
    setTimeout(() => this.items.update(items => items.filter(item => item.id !== id)), 3400);
  }
}
