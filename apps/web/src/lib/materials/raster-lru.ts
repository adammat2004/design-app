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
 *
 * **Two caps, and each answers a different question.** `maxEntries` is about the *working set* —
 * how many distinct surfaces and zooms a user moves between before coming back. `maxBytes` is
 * about memory, and it became necessary the moment rasters started being allocated at the display's
 * pixel ratio: a count-based cap prices every entry the same, but a raster's cost is the square of
 * the density it was drawn at, so the same 150 entries are four times the memory on a Retina
 * display. Counting entries there is not a conservative approximation, it is the wrong unit.
 */
export interface RasterLruOptions<T> {
  /** The memory ceiling in bytes. Omitted means the entry count is the only cap. */
  maxBytes?: number;
  /** What one entry costs. Required with `maxBytes`; without it there is nothing to add up. */
  sizeOf?: (value: T) => number;
}

export class RasterLru<T> {
  private readonly entries = new Map<string, T>();
  private readonly bytes = new Map<string, number>();

  /**
   * Counted because the whole render layer is built around this cache and its effectiveness was
   * visible to nobody. A collapsed hit rate does not throw or warn — it just feels slow, on a
   * machine faster than the one it will be marked on.
   */
  private hitCount = 0;
  private missCount = 0;
  private byteTotal = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly options: RasterLruOptions<T> = {},
  ) {}

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
    // Replacing a key has to discount what was there, or the running total drifts upwards forever.
    this.drop(key);

    this.entries.set(key, value);

    const { sizeOf, maxBytes } = this.options;
    if (sizeOf) {
      const cost = sizeOf(value);
      this.bytes.set(key, cost);
      this.byteTotal += cost;
    }

    /*
     * Evict on either cap. Note the guard on `size > 1`: a single raster larger than the whole
     * budget must be kept, not evicted the instant it is inserted — the alternative is a surface
     * that can never be cached and is therefore redrawn on every frame, which is far worse than
     * briefly exceeding the ceiling.
     */
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.maxEntries ||
        (maxBytes !== undefined && this.byteTotal > maxBytes))
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.drop(oldest.value);
    }
  }

  private drop(key: string): void {
    if (!this.entries.delete(key)) return;

    const cost = this.bytes.get(key);
    if (cost !== undefined) {
      this.byteTotal -= cost;
      this.bytes.delete(key);
    }
  }

  /* ---------------------------------------------------------------- test seams */

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Hits, misses and how full it is. Read by the dev HUD; nothing in the app depends on it. */
  get stats(): {
    size: number;
    hits: number;
    misses: number;
    capacity: number;
    bytes: number;
    byteCapacity: number | null;
  } {
    return {
      size: this.entries.size,
      hits: this.hitCount,
      misses: this.missCount,
      capacity: this.maxEntries,
      bytes: this.byteTotal,
      byteCapacity: this.options.maxBytes ?? null,
    };
  }

  get size(): number {
    return this.entries.size;
  }

  /** Bytes currently held, by the caller's own accounting. Zero without a `sizeOf`. */
  get byteSize(): number {
    return this.byteTotal;
  }

  clear(): void {
    this.entries.clear();
    this.bytes.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.byteTotal = 0;
  }
}
