export interface BoundedCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly size: number;
}

/**
 * A bounded in-memory cache with FIFO eviction: once full, the oldest
 * inserted entry is dropped first. Lookups do not affect eviction order.
 */
export function createBoundedCache<K, V>(maxEntries: number): BoundedCache<K, V> {
  const entries = new Map<K, V>();

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      return entries.get(key);
    },
    set(key, value) {
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}
