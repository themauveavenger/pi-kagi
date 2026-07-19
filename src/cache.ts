/**
 * A bounded in-memory cache with FIFO eviction: once full, the oldest
 * inserted entry is dropped first. Lookups do not affect eviction order.
 *
 * One method — `lookup` — owns the full get-or-fetch-and-set dance and is
 * the sole source of the `fromCache` flag the formatter needs. A throwing
 * `miss` producer is not cached: the next call retries. `refresh` is a
 * cache-bypassing variant of `lookup`: it always calls `miss` and
 * overwrites the cached entry, returning `fromCache: false` regardless of
 * any prior value. `evict` lets a caller drop a value it has just
 * observed to be undesirable (for example, a page whose extraction
 * failed) without waiting for FIFO pressure to push it out. The cache
 * stays pure of cancellation/AbortSignal concerns — `signal` threads
 * through the caller's closure into the producer, never through this
 * interface.
 */
export interface BoundedCache<K, V> {
  lookup(key: K, miss: (key: K) => Promise<V>): Promise<{ value: V; fromCache: boolean }>;
  refresh(key: K, miss: (key: K) => Promise<V>): Promise<{ value: V; fromCache: boolean }>;
  evict(key: K): boolean;
}

export function createBoundedCache<K, V>(maxEntries: number): BoundedCache<K, V> {
  const entries = new Map<K, V>();

  function evictIfNeeded(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return {
    async lookup(key, miss) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        return { value: cached, fromCache: true };
      }
      const value = await miss(key);
      entries.set(key, value);
      evictIfNeeded();
      return { value, fromCache: false };
    },
    async refresh(key, miss) {
      // Bypass the cache: always call miss and overwrite the cached entry.
      // A throwing miss propagates without storing, so a failed refresh
      // leaves whatever was already cached untouched.
      const value = await miss(key);
      entries.set(key, value);
      evictIfNeeded();
      return { value, fromCache: false };
    },
    evict(key) {
      return entries.delete(key);
    },
  };
}