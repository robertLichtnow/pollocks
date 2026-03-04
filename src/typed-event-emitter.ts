type Listener<T> = (data: T) => void;

export class TypedEventEmitter<TMap extends Record<string, unknown>> {
  private listeners = new Map<keyof TMap, Set<Listener<any>>>();

  on<K extends keyof TMap>(event: K, fn: Listener<TMap[K]>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  off<K extends keyof TMap>(event: K, fn: Listener<TMap[K]>): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        fn(data);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
