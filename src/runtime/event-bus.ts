import type { RuntimeEvent } from "./contracts.js";

export class EventBus {
  private readonly log: RuntimeEvent[] = [];
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  append(event: RuntimeEvent): void {
    this.log.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): RuntimeEvent[] {
    return [...this.log];
  }
}

