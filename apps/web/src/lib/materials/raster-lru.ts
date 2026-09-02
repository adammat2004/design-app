/**
 * A least-recently-used store for rendered rasters.
 *
 * Extracted when the shadow layer needed the same thing the surface patterns already had. The
 * eviction logic is four lines and the temptation is to write it twice, but the subtle half is
 * not the eviction — it is that a *hit* has to re-insert the entry to move it to the end of the
 * Map's insertion order. Get that wrong in one copy and the cache still works, just with the
 * wrong eviction order, which shows up as an unexplained stutter rather than as a bug.
 *
 * `Map` iterates in insertion order, so the first key is always the least recently used and the
 * whole structure is the LRU list. No second data structure, no timestamps.
 */
export class RasterLru<T> {
  private readonly entries = new Map<string, T>();

  /**
   * Counted because the whole render layer is built around this cache and its effectiveness was
   * visible to nobody. A collapsed hit rate does not throw or warn — it just feels slow, on a
   * machine faster than the one it will be marked on.
   */
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const existing = this.entries.get(key);
    if (existing === undefined) {
      this.missCount += 1;
      return undefined;
    }

    this.hitCount += 1;

    // Re-inserting moves it to the end, which is what makes this an LRU rather than a FIFO.
    this.entries.delete(key);
    this.entries.set(key, existing);

    return existing;
  }

  set(key: string, value: T): void {
    this.entries.set(key, value);

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }

  /* ---------------------------------------------------------------- test seams */

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Hits, misses and how full it is. Read by the dev HUD; nothing in the app depends on it. */
  get stats(): { size: number; hits: number; misses: number; capacity: number } {
    return {
      size: this.entries.size,
      hits: this.hitCount,
      misses: this.missCount,
      capacity: this.maxEntries,
    };
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
}
