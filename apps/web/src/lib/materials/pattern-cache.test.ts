import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { Point } from '@garden-studio/schema';
import { resolvePattern, type MaterialManifestEntry } from './palette';
import {
  bucketScale,
  clearPatternCache,
  getSurfacePattern,
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
    // Fill past the cap, touching the first entry part-way so it is not the coldest.
    const first = request({ elementId: 'element-0' });
    getSurfacePattern(first, makeCanvas);

    for (let i = 1; i < 48; i += 1) {
      getSurfacePattern(request({ elementId: `element-${i}` }), makeCanvas);
      if (i === 30) getSurfacePattern(first, makeCanvas);
    }

    expect(patternCacheSize()).toBe(48);

    getSurfacePattern(request({ elementId: 'element-48' }), makeCanvas);

    expect(patternCacheSize()).toBe(48);
    // Touched at 30, so it outlived the entries added before that.
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
  it('names the element, the material and the bucket', () => {
    const key = patternKey(request());

    expect(key.startsWith('element-1:stone-pavers:')).toBe(true);
    expect(key.endsWith(`:${zoomBucket(32)}`)).toBe(true);
  });
});
