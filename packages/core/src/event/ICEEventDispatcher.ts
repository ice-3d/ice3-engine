import { ICEEvent } from './ICEEvent';

type StoredListener = Readonly<{
  listener: (event: ICEEvent<unknown>) => void;
  once: boolean;
}>;

export class ICEEventDispatcher {
  private readonly listeners = new Map<string, StoredListener[]>();

  on<T>(type: string, listener: (event: ICEEvent<T>) => void): this {
    return this.add(type, listener, false);
  }

  once<T>(type: string, listener: (event: ICEEvent<T>) => void): this {
    return this.add(type, listener, true);
  }

  off<T>(type: string, listener?: (event: ICEEvent<T>) => void): this {
    if (!listener) {
      this.listeners.delete(type);
      return this;
    }

    const current = this.listeners.get(type);
    if (!current) {
      return this;
    }

    const next = current.filter((entry) => entry.listener !== listener);
    if (next.length === 0) {
      this.listeners.delete(type);
    } else {
      this.listeners.set(type, next);
    }
    return this;
  }

  trigger<T>(type: string, param?: T): this {
    const current = this.listeners.get(type);
    if (!current) {
      return this;
    }

    const event = new ICEEvent(type, this, param);
    for (const entry of [...current]) {
      if (entry.once) {
        const latest = this.listeners.get(type);
        if (latest) {
          const next = latest.filter((candidate) => candidate !== entry);
          if (next.length === 0) {
            this.listeners.delete(type);
          } else {
            this.listeners.set(type, next);
          }
        }
      }
      entry.listener(event as ICEEvent<unknown>);
    }
    return this;
  }

  private add<T>(
    type: string,
    listener: (event: ICEEvent<T>) => void,
    once: boolean,
  ): this {
    const current = this.listeners.get(type) ?? [];
    current.push({
      listener: listener as (event: ICEEvent<unknown>) => void,
      once,
    });
    this.listeners.set(type, current);
    return this;
  }
}
