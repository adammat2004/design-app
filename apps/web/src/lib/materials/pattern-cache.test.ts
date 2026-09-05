import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { Point } from '@garden-studio/schema';
import { resolvePattern, type MaterialManifestEntry } from './palette';
import {
  bucketScale,
  clearPatternCache,
  getSurfacePattern,
  MAX_ENTRIES,
  patternCacheHas,
  patternCacheSize,
  patternKey,
  zoomBucket,
  type PatternRequest,
} from './pattern-cache';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

const MATERIAL = resolvePattern('stone-pavers');
if (!MATERIAL) throw new Error('stone-pavers must have a pattern manifest for these tests');

const material: MaterialManifestEntry = MATERIAL;

/** The tests need a real canvas for the same reason the renderer's do — jsdom has no 2D context. */
const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

const outline: Point[] = [
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 5, y: 4 },
  { x: 1, y: 4 },
];

function request(overrides: Partial<PatternRequest> = {}): PatternRequest {
  return {
    elementId: 'element-1',
    material,
    outline,
    origin: { x: 0, y: 0 },
    rotation: 0,
    pxPerMetre: 32,
    ...overrides,
  };
}

beforeEach(() => {
  clearPatternCache();
});

describe('zoom bucketing', () => {
  it('holds one bucket across a √2 span of scales', () => {
    // The eased zoom in `use-canvas-viewport` changes the scale every frame; without bucketing
    // that would be a full redraw per frame.
    expect(zoomBucket(32)).toBe(zoomBucket(33));
    expect(zoomBucket(32)).toBe(zoomBucket(38));
  });

  it('moves to a new bucket once the scale has moved far enough', () => {
    expect(zoomBucket(32)).not.toBe(zoomBucket(64));
    expect(zoomBucket(32)).not.toBe(zoomBucket(16));
  });

  it('rasterises at the bucket, not at the live scale', () => {
    expect(bucketScale(zoomBucket(32))).toBeCloseTo(32, 5);
    // Every bucket is a power of √2, so consecutive buckets are a factor of √2 apart.
    expect(bucketScale(zoomBucket(32) + 1) / bucketScale(zoomBucket(32))).toBeCloseTo(
      Math.SQRT2,
      5,
    );
  });
});

describe('the pattern cache', () => {
  it('draws once and serves the same raster afterwards', () => {
    const first = getSurfacePattern(request(), makeCanvas);
    const second = getSurfacePattern(request(), makeCanvas);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(patternCacheSize()).toBe(1);
  });

  it('reuses the raster for a scale inside the same bucket', () => {
    const first = getSurfacePattern(request({ pxPerMetre: 32 }), makeCanvas);
    const nudged = getSurfacePattern(request({ pxPerMetre: 33 }), makeCanvas);

    expect(nudged).toBe(first);
    expect(patternCacheSize()).toBe(1);
  });

  it('redraws when the scale crosses a bucket', () => {
    getSurfacePattern(request({ pxPerMetre: 32 }), makeCanvas);
    getSurfacePattern(request({ pxPerMetre: 64 }), makeCanvas);

    expect(patternCacheSize()).toBe(2);
  });

  it('invalidates when the outline changes', () => {
    getSurfacePattern(request(), makeCanvas);

    const dragged = request({
      outline: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 4.4, y: 4 },
        { x: 1, y: 4 },
      ],
    });

    expect(patternCacheHas(dragged)).toBe(false);
  });

  it('invalidates when the material changes', () => {
    getSurfacePattern(request(), makeCanvas);

    const other = request({ material: { ...material, id: 'porcelain' } });

    expect(patternCacheHas(other)).toBe(false);
  });

  it('invalidates when the pattern is re-anchored', () => {
    getSurfacePattern(request(), makeCanvas);

    expect(patternCacheHas(request({ origin: { x: 0.3, y: 0 } }))).toBe(false);
    expect(patternCacheHas(request({ rotation: 45 }))).toBe(false);
  });

  it('is not invalidated by state the pixels do not depend on', () => {
    /*
     * The point of hashing the outline rather than keying on a revision counter. Selecting a
     * shape, renaming it or dragging a *different* element all re-render this component, and none
     * of them may cost a redraw — that is what keeps a pan under frame budget.
     */
    getSurfacePattern(request(), makeCanvas);

    // Same surface, same geometry, same zoom: whatever else changed in the store is not in the key.
    expect(patternCacheHas(request())).toBe(true);
    expect(patternCacheSize()).toBe(1);
  });

  it('ignores floating-point noise in the outline', () => {
    // A live drag produces coordinates that differ in the twelfth decimal place constantly.
    getSurfacePattern(request(), makeCanvas);

    const jittered = request({
      outline: outline.map((point) => ({ x: point.x + 1e-12, y: point.y - 1e-12 })),
    });

    expect(patternCacheHas(jittered)).toBe(true);
  });

  it('gives two surfaces separate entries', () => {
    getSurfacePattern(request({ elementId: 'element-1' }), makeCanvas);
    getSurfacePattern(request({ elementId: 'element-2' }), makeCanvas);

    expect(patternCacheSize()).toBe(2);
  });

  it('evicts the least recently used raster once it is full', () => {
    /*
     * Derived from MAX_ENTRIES rather than repeating its value. The cap is a tuning number that
     * moves when the shape of a generated plan changes; this test is about the eviction ORDER,
     * and it should not fail merely because the cap was resized.
     */
    const touchAt = Math.floor(MAX_ENTRIES * 0.6);

    // Fill to the cap, touching the first entry part-way so it is not the coldest.
    const first = request({ elementId: 'element-0' });
    getSurfacePattern(first, makeCanvas);

    for (let i = 1; i < MAX_ENTRIES; i += 1) {
      getSurfacePattern(request({ elementId: `element-${i}` }), makeCanvas);
      if (i === touchAt) getSurfacePattern(first, makeCanvas);
    }

    expect(patternCacheSize()).toBe(MAX_ENTRIES);

    getSurfacePattern(request({ elementId: `element-${MAX_ENTRIES}` }), makeCanvas);

    expect(patternCacheSize()).toBe(MAX_ENTRIES);
    // Touched part-way through, so it outlived the entries added before that.
    expect(patternCacheHas(first)).toBe(true);
    expect(patternCacheHas(request({ elementId: 'element-1' }))).toBe(false);
  });

  it('returns null for a degenerate outline without caching it', () => {
    const degenerate = request({
      outline: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 9, y: 1 },
      ],
    });

    expect(getSurfacePattern(degenerate, makeCanvas)).toBeNull();
    expect(patternCacheSize()).toBe(0);
  });
});

describe('patternKey', () => {
  it('names the element, the material, the bucket and the pixel ratio', () => {
    const key = patternKey(request());

    expect(key.startsWith('element-1:stone-pavers:')).toBe(true);
    expect(key.endsWith(`:${zoomBucket(32)}:1:`)).toBe(true);
  });
});

describe('the light in the key', () => {
  /**
   * Added when the light stopped being a compile-time constant.
   *
   * Leaving it out was harmless while every surface was lit from the same hardcoded corner. The
   * moment it follows the sun it becomes a correctness bug: moving the time slider would repaint
   * only the surfaces that happened to fall out of the cache, so the plan relights in patches —
   * which reads as a rendering fault rather than as a stale cache.
   */
  it('changes when the light moves', () => {
    const noon = request({ light: { x: 0, y: 1 } });
    const evening = request({ light: { x: -0.7, y: -0.7 } });

    expect(patternKey(noon)).not.toBe(patternKey(evening));
  });

  it('tells the conventional light apart from a real one', () => {
    expect(patternKey(request())).not.toBe(patternKey(request({ light: { x: 0, y: 1 } })));
  });

  it('absorbs floating-point noise rather than invalidating on it', () => {
    // The solar maths returns values that wobble in the far decimals between calls; a raster
    // must not be thrown away for that.
    const a = request({ light: { x: 0.7071067811865476, y: -0.7071067811865475 } });
    const b = request({ light: { x: 0.70710678118654, y: -0.70710678118654 } });

    expect(patternKey(a)).toBe(patternKey(b));
  });
});

describe('the asset version in the key', () => {
  /**
   * Same argument as the light. A surface drawn before its texture arrived and the same surface
   * drawn after are different pixels; without the version in the key the plan would texture in
   * patches as rasters happened to fall out of the cache.
   */
  it('changes when the assets arrive', () => {
    expect(patternKey(request({ assetVersion: 'none' }))).not.toBe(
      patternKey(request({ assetVersion: 'abc123' })),
    );
  });

  it('treats an absent version as "none"', () => {
    expect(patternKey(request())).toBe(patternKey(request({ assetVersion: 'none' })));
  });

  it('redraws exactly once when the version flips, then hits again', () => {
    const before = request({ assetVersion: 'none' });
    const after = request({ assetVersion: 'abc123' });

    getSurfacePattern(before, makeCanvas);
    expect(patternCacheHas(before)).toBe(true);
    expect(patternCacheHas(after)).toBe(false);

    getSurfacePattern(after, makeCanvas);
    expect(patternCacheHas(after)).toBe(true);
    expect(patternCacheSize()).toBe(2);
  });
});

describe('the pixel ratio', () => {
  /**
   * Konva renders its stage at `devicePixelRatio`, so every stroke it draws is at that density.
   * Before this, the surface rasters were allocated from CSS pixels per metre and then upscaled by
   * the stage — half the density of the lines drawn on top of them. These pin the fix.
   */
  it('draws twice the linear pixels at ratio 2', () => {
    const one = getSurfacePattern(request({ pixelRatio: 1 }), makeCanvas);
    const two = getSurfacePattern(request({ pixelRatio: 2 }), makeCanvas);

    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(two!.widthPx).toBe(one!.widthPx * 2);
    expect(two!.heightPx).toBe(one!.heightPx * 2);
  });

  /**
   * The compensation that keeps a metre a metre. `useSurfacePattern` divides the live CSS zoom by
   * the density the raster reports, so a denser raster must report a proportionally higher one —
   * otherwise the texture would be drawn at half size on a Retina display.
   */
  it('reports the density it actually drew at, so the drawn world size is unchanged', () => {
    const scale = 32;
    const one = getSurfacePattern(request({ pxPerMetre: scale, pixelRatio: 1 }), makeCanvas)!;
    const two = getSurfacePattern(request({ pxPerMetre: scale, pixelRatio: 2 }), makeCanvas)!;

    expect(two.pxPerMetre).toBe(one.pxPerMetre * 2);

    // What `useSurfacePattern` hands Konva: the image is half the scale but twice the pixels, so
    // it covers exactly the same metres.
    expect(two.widthPx * (scale / two.pxPerMetre)).toBeCloseTo(
      one.widthPx * (scale / one.pxPerMetre),
      6,
    );
  });

  /** In the key, because it changes the pixels — the same rule as `light` and `assetVersion`. */
  it('is in the cache key', () => {
    expect(patternKey(request({ pixelRatio: 1 }))).not.toBe(
      patternKey(request({ pixelRatio: 2 })),
    );
  });

  it('treats an absent ratio as 1', () => {
    expect(patternKey(request())).toBe(patternKey(request({ pixelRatio: 1 })));
  });

  /**
   * The bucket must stay quantised on CSS pixels per metre. Bucketing device pixels instead would
   * move the boundaries with the display, so the same plan at the same zoom would be a different
   * entry on a laptop and on the monitor beside it — and the zoom-sweep sheet that shows where the
   * level-of-detail floors bite would mean something different on each machine.
   */
  it('does not shift the zoom buckets', () => {
    const at = (pixelRatio: number) => patternKey(request({ pxPerMetre: 32, pixelRatio }));
    // Third from the end now: the tail is bucket, pixel ratio, planting style.
    const bucketOf = (key: string) => key.split(':').at(-3);

    expect(bucketOf(at(1))).toBe(bucketOf(at(2)));
    expect(bucketOf(at(1))).toBe(String(zoomBucket(32)));
  });
});

describe('a live drag or resize', () => {
  /**
   * The outline changes on every frame of a gesture, so the key changes on every frame: the
   * surface is fully repainted each time *and* the entries it leaves behind are dead before they
   * are ever read. Sixty of those a second evict the static surfaces still on screen, which is how
   * dragging one bed ends up making the rest of the plan slow.
   */
  it('does not keep the rasters a gesture produces', () => {
    const moving = request({ elementId: 'dragged', interacting: true });

    expect(getSurfacePattern(moving, makeCanvas)).not.toBeNull();
    expect(patternCacheSize()).toBe(0);
  });

  it('leaves the entry the surface already had untouched', () => {
    const still = request({ elementId: 'dragged' });
    getSurfacePattern(still, makeCanvas);
    expect(patternCacheSize()).toBe(1);

    // A frame of the gesture, at a different outline.
    getSurfacePattern(
      request({
        elementId: 'dragged',
        interacting: true,
        outline: outline.map((point) => ({ x: point.x + 0.5, y: point.y })),
      }),
      makeCanvas,
    );

    expect(patternCacheSize()).toBe(1);
    expect(patternCacheHas(still)).toBe(true);
  });

  /**
   * Not in the key. It is a property of the moment rather than of the pixels, and keying on it
   * would hold a coarse copy of every surface forever for a state that lasts as long as a mouse
   * button is held.
   */
  it('is not part of the cache key', () => {
    expect(patternKey(request({ interacting: true }))).toBe(
      patternKey(request({ interacting: false })),
    );
  });
});
