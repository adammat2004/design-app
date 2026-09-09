import { RasterLru } from '@/lib/materials/raster-lru';

/**
 * Loaded tiles, and the loads in flight.
 *
 * The same `RasterLru` the surface patterns use, with a byte budget rather than a count: a
 * high-density tile is four times the memory of a plain one and counting them the same would be
 * the wrong unit, for the reason `raster-lru.ts` gives. Sixty-four megabytes is about two hundred
 * and fifty retina tiles — several screens' worth in every direction.
 *
 * Loads go through `fetch` rather than an `Image` so they can be **aborted**: a wheel gesture
 * sweeps through several zoom levels, and every tile requested for a level the view has already
 * left is bandwidth spent on pixels nobody sees. `createImageBitmap` decodes off the main thread
 * and the result draws straight into Konva.
 *
 * The loader is injectable so the cache can be exercised in Node with no network and no images.
 */
export type TileImage = CanvasImageSource & { width: number; height: number };
export type TileLoader = (url: string, signal: AbortSignal) => Promise<TileImage>;

export const TILE_CACHE_BYTES = 64 * 1024 * 1024;

export const fetchTile: TileLoader = async (url, signal) => {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) throw new Error(`Tile ${url} answered ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  return bitmap;
};

export class TileCache {
  private readonly images: RasterLru<TileImage>;
  private readonly inFlight = new Map<string, AbortController>();
  /** Keys that failed, so a missing tile is not re-requested on every frame. */
  private readonly failed = new Set<string>();

  constructor(
    private readonly loader: TileLoader = fetchTile,
    maxBytes = TILE_CACHE_BYTES,
  ) {
    this.images = new RasterLru<TileImage>(2_000, {
      maxBytes,
      sizeOf: (image) => image.width * image.height * 4,
    });
  }

  get(key: string): TileImage | undefined {
    return this.images.get(key);
  }

  has(key: string): boolean {
    return this.images.has(key);
  }

  isLoading(key: string): boolean {
    return this.inFlight.has(key);
  }

  hasFailed(key: string): boolean {
    return this.failed.has(key);
  }

  /**
   * Starts a load unless one is cached, in flight or known to fail. Resolves to whether the tile
   * landed; the caller redraws on true. Never rejects — a tile that fails to load is a hole in
   * the picture, not an error in the plan.
   */
  async load(key: string, url: string): Promise<boolean> {
    if (this.images.has(key) || this.inFlight.has(key) || this.failed.has(key)) return false;

    const controller = new AbortController();
    this.inFlight.set(key, controller);

    try {
      const image = await this.loader(url, controller.signal);
      // Aborted loads that still resolved are dropped: the view has moved on.
      if (controller.signal.aborted) return false;
      this.images.set(key, image);
      return true;
    } catch {
      if (!controller.signal.aborted) this.failed.add(key);
      return false;
    } finally {
      if (this.inFlight.get(key) === controller) this.inFlight.delete(key);
    }
  }

  /** Cancels every load whose key is not in `keep`. */
  abortExcept(keep: ReadonlySet<string>): void {
    for (const [key, controller] of this.inFlight) {
      if (!keep.has(key)) {
        controller.abort();
        this.inFlight.delete(key);
      }
    }
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.abortExcept(new Set());
    this.images.clear();
    this.failed.clear();
  }
}
