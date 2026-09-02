import type { Point, ShadowCast, ShadowOccluder } from '@garden-studio/schema';
import { hashString } from './prng';
import { RasterLru } from './raster-lru';
import { bucketScale, zoomBucket } from './pattern-cache';
import { renderShadowLayer, type ShadowRaster } from './render-shadow-layer';
import type { MakeCanvas } from './render-surface-pattern';

/**
 * The plan's shadow layer, kept.
 *
 * One raster for the whole plan rather than one per element, which is the opposite of how surface
 * patterns are cached and follows from what a shadow is: a mark belonging to one object that
 * lands on another. There is nothing to key per element because the layer is the union.
 *
 * Small on purpose. The entries are plot-sized rasters — the biggest images the app produces —
 * and there is only one live layer at a time, so this holds a few zoom buckets rather than a
 * garden's worth of bitmaps.
 */
const MAX_ENTRIES = 4;

const cache = new RasterLru<ShadowRaster>(MAX_ENTRIES);

export interface ShadowRequest {
  occluders: ShadowOccluder[];
  cast: ShadowCast;
  /** World metres, already tessellated. The layer is clipped to this. */
  boundary: Point[];
  pxPerMetre: number;
}

/**
 * The cache key, naming everything the pixels depend on and nothing else.
 *
 * Note what is deliberately **absent**: pan. The raster is anchored in world metres, so scrolling
 * the plot around changes nothing about the image — the same property that keeps a pan at zero
 * regenerations for surface patterns.
 *
 * The sun *is* in the key, quantised only enough to absorb floating-point noise rather than to
 * hold still across a real change. A time-of-day drag genuinely should redraw this — that is the
 * feature — and one plot-sized raster over a handful of occluders is far cheaper than the sixteen
 * surface patterns a sun change would otherwise invalidate. What the key protects against is
 * regenerating when something unrelated re-renders: selecting a shape, renaming it, panning.
 */
export function shadowLayerKey(request: ShadowRequest): string {
  const occluders = request.occluders
    .map((occluder) => `${round(occluder.height)}@${ring(occluder.outline)}`)
    .join('|');

  const sun = [
    round(request.cast.direction.x),
    round(request.cast.direction.y),
    round(request.cast.lengthPerMetre),
  ].join(',');

  return [
    hashString(occluders).toString(36),
    hashString(ring(request.boundary)).toString(36),
    sun,
    zoomBucket(request.pxPerMetre),
  ].join(':');
}

/** The shadow layer for this plan at this zoom, drawn if it is not already held. */
export function getShadowLayer(
  request: ShadowRequest,
  makeCanvas: MakeCanvas,
): ShadowRaster | null {
  const key = shadowLayerKey(request);
  const existing = cache.get(key);
  if (existing) return existing;

  const bucket = zoomBucket(request.pxPerMetre);

  const raster = renderShadowLayer(request.occluders, request.cast, request.boundary, {
    // The bucket's scale, never the raw zoom — the same substitution the surface cache makes,
    // and for the same reason: `use-canvas-viewport` eases zoom through requestAnimationFrame,
    // so the raw value changes on every frame of a wheel gesture.
    pxPerMetre: bucketScale(bucket),
    makeCanvas,
  });

  if (!raster) return null;

  cache.set(key, raster);

  return raster;
}

function ring(points: Point[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(';');
}

/** Rounded before hashing, to a tenth of a millimetre — see `pattern-cache`'s `round`. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/* ---------------------------------------------------------------- test seams */

export function clearShadowCache(): void {
  cache.clear();
}

export function shadowCacheSize(): number {
  return cache.size;
}

export function shadowCacheHas(request: ShadowRequest): boolean {
  return cache.has(shadowLayerKey(request));
}

/** Hit rate and occupancy, for the dev HUD. Nothing in the app reads this. */
export function shadowCacheStats() {
  return cache.stats;
}
