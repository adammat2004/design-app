import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { Point, ShadowCast, ShadowOccluder } from '@garden-studio/schema';
import {
  clearShadowCache,
  getShadowLayer,
  shadowCacheSize,
  shadowLayerKey,
  type ShadowRequest,
} from './shadow-cache';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

const NOON: ShadowCast = { direction: { x: 0, y: -1 }, lengthPerMetre: 1 };

const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

const OCCLUDER: ShadowOccluder = {
  outline: [
    { x: 5, y: 10 },
    { x: 7, y: 10 },
    { x: 7, y: 12 },
    { x: 5, y: 12 },
  ],
  height: 4,
};

function request(over: Partial<ShadowRequest> = {}): ShadowRequest {
  return { occluders: [OCCLUDER], cast: NOON, boundary: PLOT, pxPerMetre: 32, ...over };
}

beforeEach(clearShadowCache);

describe('shadowLayerKey', () => {
  it('is stable for the same plan, so an unrelated re-render is a hit', () => {
    // Selecting a shape, renaming one, or anything else that re-renders the canvas must not
    // redraw the biggest raster in the app.
    expect(shadowLayerKey(request())).toBe(shadowLayerKey(request()));
  });

  it('changes when the sun moves', () => {
    const evening: ShadowCast = { direction: { x: -0.7, y: -0.7 }, lengthPerMetre: 3 };

    expect(shadowLayerKey(request({ cast: evening }))).not.toBe(shadowLayerKey(request()));
  });

  it('changes when an occluder moves', () => {
    const moved = {
      ...OCCLUDER,
      outline: OCCLUDER.outline.map((point) => ({ ...point, x: point.x + 3 })),
    };

    expect(shadowLayerKey(request({ occluders: [moved] }))).not.toBe(shadowLayerKey(request()));
  });

  it('changes when an occluder gets taller', () => {
    // The bug the height manifest exists to prevent: a fence and a tree casting the same shadow.
    const taller = { ...OCCLUDER, height: 6 };

    expect(shadowLayerKey(request({ occluders: [taller] }))).not.toBe(shadowLayerKey(request()));
  });

  it('changes when the plot is reshaped, because the layer is clipped to it', () => {
    const smaller = PLOT.map((point) => ({ ...point, x: point.x * 0.5 }));

    expect(shadowLayerKey(request({ boundary: smaller }))).not.toBe(shadowLayerKey(request()));
  });

  it('holds still across a zoom that stays inside one bucket', () => {
    // `use-canvas-viewport` eases zoom through requestAnimationFrame, so the raw scale changes on
    // every frame of a wheel gesture. Keyed on that, this would redraw sixty times a second.
    expect(shadowLayerKey(request({ pxPerMetre: 32.4 }))).toBe(shadowLayerKey(request()));
  });

  it('changes once the zoom crosses a bucket', () => {
    expect(shadowLayerKey(request({ pxPerMetre: 128 }))).not.toBe(shadowLayerKey(request()));
  });
});

describe('getShadowLayer', () => {
  it('draws once and then hits', () => {
    const first = getShadowLayer(request(), makeCanvas);
    const second = getShadowLayer(request(), makeCanvas);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(shadowCacheSize()).toBe(1);
  });

  it('caches at the bucket scale, not the raw zoom', () => {
    // Two scales inside one bucket must return the same raster object, not two near-identical
    // plot-sized bitmaps.
    const a = getShadowLayer(request({ pxPerMetre: 32 }), makeCanvas);
    const b = getShadowLayer(request({ pxPerMetre: 34 }), makeCanvas);

    expect(b).toBe(a);
    expect(shadowCacheSize()).toBe(1);
  });

  it('holds a few zoom buckets rather than one', () => {
    for (const pxPerMetre of [8, 16, 32, 64]) {
      getShadowLayer(request({ pxPerMetre }), makeCanvas);
    }

    expect(shadowCacheSize()).toBeGreaterThan(1);
  });

  it('stays small, because these are the biggest rasters the app makes', () => {
    for (const pxPerMetre of [2, 4, 8, 16, 32, 64, 128, 256]) {
      getShadowLayer(request({ pxPerMetre }), makeCanvas);
    }

    expect(shadowCacheSize()).toBeLessThanOrEqual(4);
  });

  it('is null when nothing casts a shadow', () => {
    expect(getShadowLayer(request({ occluders: [] }), makeCanvas)).toBeNull();
    expect(shadowCacheSize()).toBe(0);
  });
});
