import { describe, expect, it, vi } from 'vitest';
import { TileCache, type TileImage, type TileLoader } from './tile-cache';

/** A fake tile: nothing draws it, so any object with a size will do. */
function image(size = 256): TileImage {
  return { width: size, height: size } as unknown as TileImage;
}

/** A loader whose promises are resolved by the test, so in-flight state can be observed. */
function controllableLoader() {
  const pending = new Map<string, { resolve: (image: TileImage) => void; reject: (e: Error) => void; signal: AbortSignal }>();
  const loader: TileLoader = (url, signal) =>
    new Promise((resolve, reject) => {
      pending.set(url, { resolve, reject, signal });
    });
  return { loader, pending };
}

describe('TileCache', () => {
  it('loads once, then serves from the cache', async () => {
    const loader = vi.fn<TileLoader>(async () => image());
    const cache = new TileCache(loader);

    expect(await cache.load('19/1/1', 'https://t/19/1/1')).toBe(true);
    expect(cache.has('19/1/1')).toBe(true);
    expect(await cache.load('19/1/1', 'https://t/19/1/1')).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates a load already in flight', async () => {
    const { loader, pending } = controllableLoader();
    const cache = new TileCache(loader);

    const first = cache.load('k', 'u');
    const second = cache.load('k', 'u');
    expect(cache.isLoading('k')).toBe(true);
    expect(pending.size).toBe(1);

    pending.get('u')!.resolve(image());
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(cache.isLoading('k')).toBe(false);
  });

  it('aborts loads that fell out of view and drops their result', async () => {
    const { loader, pending } = controllableLoader();
    const cache = new TileCache(loader);

    const stale = cache.load('old', 'u-old');
    const kept = cache.load('new', 'u-new');
    cache.abortExcept(new Set(['new']));

    expect(pending.get('u-old')!.signal.aborted).toBe(true);
    expect(pending.get('u-new')!.signal.aborted).toBe(false);
    expect(cache.inFlightCount).toBe(1);

    // A stale load that resolves anyway is thrown away rather than cached.
    pending.get('u-old')!.resolve(image());
    expect(await stale).toBe(false);
    expect(cache.has('old')).toBe(false);

    pending.get('u-new')!.resolve(image());
    expect(await kept).toBe(true);
  });

  it('remembers a failed tile rather than requesting it every frame', async () => {
    const loader = vi.fn<TileLoader>(async () => {
      throw new Error('404');
    });
    const cache = new TileCache(loader);

    expect(await cache.load('k', 'u')).toBe(false);
    expect(cache.hasFailed('k')).toBe(true);
    expect(await cache.load('k', 'u')).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts by bytes, keeping the most recently used tiles', async () => {
    // Room for three 256 px tiles and no more.
    const cache = new TileCache(async () => image(), 3 * 256 * 256 * 4);

    for (const key of ['a', 'b', 'c']) await cache.load(key, key);
    cache.get('a'); // touch, so `b` is now the oldest
    await cache.load('d', 'd');

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });
});
