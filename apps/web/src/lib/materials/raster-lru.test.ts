import { describe, expect, it } from 'vitest';
import { RasterLru } from './raster-lru';

describe('RasterLru', () => {
  it('returns what it was given', () => {
    const lru = new RasterLru<string>(3);
    lru.set('a', 'one');

    expect(lru.get('a')).toBe('one');
    expect(lru.get('missing')).toBeUndefined();
  });

  it('evicts the oldest once it is over the cap', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');
    lru.set('c', '3');

    expect(lru.size).toBe(2);
    expect(lru.has('a')).toBe(false);
    expect(lru.has('c')).toBe(true);
  });

  /**
   * The subtle half, and the reason this is shared rather than written twice.
   *
   * A hit has to move the entry to the end of the insertion order. Skip that and the structure
   * still caches correctly — it just evicts in insertion order instead of use order, which shows
   * up as an unexplained stutter rather than as anything that looks like a bug.
   */
  it('counts a read as a use, so a hot entry outlives a colder one added later', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');

    lru.get('a'); // 'a' is now the most recently used, so 'b' is the coldest.
    lru.set('c', '3');

    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
  });

  it('does not count a miss as a use', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');

    lru.get('nothing-here');
    lru.set('c', '3');

    // 'a' was still the coldest; the failed lookup must not have disturbed the order.
    expect(lru.has('a')).toBe(false);
  });

  it('overwrites rather than duplicating a key', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', 'first');
    lru.set('a', 'second');

    expect(lru.size).toBe(1);
    expect(lru.get('a')).toBe('second');
  });

  it('clears', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.clear();

    expect(lru.size).toBe(0);
  });
});

describe('stats', () => {
  /**
   * Counted because the render layer is built around this cache and its effectiveness was visible
   * to nobody. A collapsed hit rate does not throw and does not warn — it just feels slightly slow,
   * on a development machine faster than the one the work will be judged on.
   */
  it('counts hits and misses separately', () => {
    const lru = new RasterLru<string>(4);

    lru.get('cold');
    lru.set('warm', '1');
    lru.get('warm');
    lru.get('warm');

    expect(lru.stats).toMatchObject({ hits: 2, misses: 1, size: 1, capacity: 4 });
  });

  it('resets the counts on clear, so a fresh measurement starts clean', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.get('a');
    lru.clear();

    expect(lru.stats).toMatchObject({ hits: 0, misses: 0, size: 0 });
  });

  it('does not count a set as a hit', () => {
    // Only reads say anything about whether the cache is earning its place.
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');

    expect(lru.stats.hits).toBe(0);
  });
});

describe('the byte budget', () => {
  /**
   * Counting entries prices a 3 m² bed and a 300 m² base fill the same, and a raster's cost is the
   * square of the density it was drawn at — so the same entry count is four times the memory once
   * rasters are allocated at a Retina display's pixel ratio. These pin the second cap.
   */
  const sized = (bytes: number) => ({ bytes });
  const options = { maxBytes: 100, sizeOf: (value: { bytes: number }) => value.bytes };

  it('evicts on bytes even when the entry count is nowhere near the cap', () => {
    const lru = new RasterLru(50, options);
    lru.set('a', sized(60));
    lru.set('b', sized(60));

    expect(lru.size).toBe(1);
    expect(lru.has('a')).toBe(false);
    expect(lru.has('b')).toBe(true);
  });

  it('discounts a replaced key rather than letting the total drift up', () => {
    const lru = new RasterLru(50, options);
    lru.set('a', sized(40));
    lru.set('a', sized(40));

    expect(lru.size).toBe(1);
    expect(lru.byteSize).toBe(40);
  });

  it('keeps the total honest as entries are evicted', () => {
    const lru = new RasterLru(50, options);
    lru.set('a', sized(50));
    lru.set('b', sized(50));
    expect(lru.byteSize).toBe(100);

    lru.set('c', sized(50));
    expect(lru.byteSize).toBe(100);
    expect(lru.has('a')).toBe(false);
  });

  /**
   * A single raster larger than the whole budget has to be kept. Evicting it the instant it is
   * inserted gives a surface that can never be cached and is therefore redrawn on every frame,
   * which is far worse than briefly exceeding the ceiling.
   */
  it('keeps one entry that is bigger than the whole budget', () => {
    const lru = new RasterLru(50, options);
    lru.set('huge', sized(500));

    expect(lru.has('huge')).toBe(true);
    expect(lru.size).toBe(1);
  });

  it('leaves the entry count as the only cap when no budget is given', () => {
    const lru = new RasterLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');

    expect(lru.byteSize).toBe(0);
    expect(lru.stats.byteCapacity).toBeNull();
    expect(lru.size).toBe(2);
  });
});
