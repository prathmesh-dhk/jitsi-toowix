/**
 * A thin Map-with-TTL cache. Single process only (no cross-instance consistency) -- correct for
 * this backend today (confirmed: single Node process, no cluster/PM2, no multi-instance config
 * anywhere in this repo). Revisit this (move to Redis) only when a second backend instance is
 * actually added; see the caching plan this was built from for that reasoning.
 *
 * Lazy eviction only: an expired entry is dropped the next time its key is read or overwritten,
 * not swept on a timer. This is enough for the pilot's two use cases (live-status keyed by
 * roomSlug, meetings-list keyed by companyId/userId) -- both key spaces are naturally small and
 * bounded by "rooms/companies currently in use", and a 5-15s TTL means a key for a room/company
 * nobody polls again just sits unused until its own TTL would have expired it anyway, which never
 * happens because lazy eviction only runs on access. A key that's read once and never again stays
 * in the Map until the process restarts -- acceptable at this pilot's scale (a handful of hot
 * endpoints, not a general-purpose cache), but worth revisiting if this pattern gets reused for a
 * much larger or longer-lived key space.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class SimpleCache<T = unknown> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Current entry count, including any not-yet-lazily-evicted expired ones. Diagnostic only. */
  get size(): number {
    return this.store.size;
  }
}
