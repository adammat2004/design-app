import type { Point } from '@garden-studio/schema';
import type { MaterialManifestEntry } from './palette';
import { hashString } from './prng';
import { RasterLru } from './raster-lru';
import {
  renderSurfacePattern,
  type MakeCanvas,
  type PatternRaster,
} from './render-surface-pattern';

/**
 * Rasters, kept.
 *
 * A patterned surface is thousands of fill calls. Handing those to Konva as shapes would be
 * hopeless, so each surface is drawn once into its own canvas and then blitted as an image — and
 * this is what stops "once" turning into "every frame".
 *
 * Two things drive that. Zoom is eased through `requestAnimationFrame` in `use-canvas-viewport.ts`,
 * so `transform.scale` changes on *every frame* of a wheel gesture; and the editor re-renders on
 * any store change at all, including selecting a shape or renaming one. A cache keyed on exactly
 * what the pixels depend on — and bucketed so a scale of 64.1 is the same request as 64.0 — turns
 * both of those into lookups.
 */

/**
 * Zoom buckets, in steps of √2.
 *
 * Two per octave. Finer and a slow zoom would regenerate often enough to be felt; coarser and a
 * raster could be stretched to 1.4× before being redrawn, which starts to look soft. Between
 * buckets the image is drawn scaled, which is why softness rather than staleness is the failure
 * mode.
 */
export function zoomBucket(pxPerMetre: number): number {
  return Math.round(Math.log2(Math.max(pxPerMetre, 1e-6)) * 2);
}

/** The scale a bucket's raster is actually drawn at. */
export function bucketScale(bucket: number): number {
  return 2 ** (bucket / 2);
}

/**
 * How many rasters to keep.
 *
 * Was 48, on the estimate that "eight surfaces is a busy plan". A *generated* plan is roughly
 * double that before anything is edited: a base fill per zone in scope, several accent beds, a
 * perimeter border cut per zone, and the placed features — call it sixteen patterned surfaces.
 * At the three zoom buckets a user touches while looking around, that working set was exactly
 * the old cap, so ordinary panning and zooming was evicting entries it was about to want back.
 *
 * 150 covers an estate-scale plan across a zoom range with room to spare. Note the level-of-
 * detail tiers must stay keyed off the existing √2 bucket rather than becoming a separate
 * dimension of the key — as a new dimension they would multiply this number, not add to it.
 */
export const MAX_ENTRIES = 150;

export interface PatternRequest {
  /** The surface's own id, which is also what makes its tones differ from its neighbour's. */
  elementId: string;
  material: MaterialManifestEntry;
  /** World metres, already tessellated by `geometryOutline` — never re-derived here. */
  outline: Point[];
  origin: Point;
  rotation: number;
  pxPerMetre: number;
  /**
   * Unit vector towards the light. Absent means the conventional drawing light.
   *
   * In the key because the pixels genuinely depend on it — module bevels and blob highlights are
   * lit from this side. Leaving it out was fine while the light was a compile-time constant, and
   * became a correctness bug the moment it started following the sun: moving the time slider
   * would repaint only the surfaces that happened to fall out of the cache, so the plan would
   * relight in patches. That reads as a rendering fault rather than a stale cache.
   */
  light?: Point;
}

interface CacheEntry {
  raster: PatternRaster;
  bucket: number;
}

const cache = new RasterLru<CacheEntry>(MAX_ENTRIES);

/**
 * The cache key.
 *
 * It names everything the pixels depend on and nothing else, which is the whole design: the
 * outline is hashed, so dragging a vertex misses and re-clips, while selecting the shape,
 * renaming it, or moving a *different* element leaves the key identical and hits.
 *
 * ```
 *   IN THE KEY                     NOT IN THE KEY               WHY IT MATTERS
 *   ──────────                     ──────────────               ──────────────
 *   elementId ─┐                   pan / stage offset     ──▶   a pan costs zero redraws:
 *   material   │                   selection, hover             the raster is anchored in
 *   outline#   ├─▶ raster          element name                  world metres, so scrolling
 *   anchor#    │   identity        any OTHER element             changes nothing about it
 *   light      │                   the store's revision
 *   zoomBucket ┘                   raw scale within a bucket ─▶  eased zoom changes the raw
 *                                                                value every frame; the
 *                                                                bucket holds it still
 * ```
 *
 * The rule to keep: if a change alters the pixels, it belongs above the line. `light` was added
 * the day the light stopped being a compile-time constant — before that it was correctly absent,
 * and afterwards its absence would have relit the plan in patches.
 */
export function patternKey(request: PatternRequest): string {
  const outline = request.outline.map((point) => `${round(point.x)},${round(point.y)}`).join(';');

  const anchor = `${round(request.origin.x)},${round(request.origin.y)},${round(request.rotation)}`;

  /*
   * Quantised to three decimals — about a twentieth of a degree of arc. Fine enough that no
   * visible relighting is ever missed, coarse enough that floating-point noise in the solar
   * maths cannot invalidate a raster on its own.
   */
  const light = request.light ? `${round(request.light.x)},${round(request.light.y)}` : 'default';

  return [
    request.elementId,
    request.material.id,
    hashString(outline).toString(36),
    hashString(anchor).toString(36),
    light,
    zoomBucket(request.pxPerMetre),
  ].join(':');
}

/**
 * Rounded before hashing, to a tenth of a millimetre.
 *
 * Without it a drag that moves a vertex by a millionth of a metre — which floating-point
 * arithmetic on a live drag produces constantly — would be a different key and a full redraw.
 */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** The raster for a surface, drawn if it is not already held. `null` for a degenerate outline. */
export function getSurfacePattern(
  request: PatternRequest,
  makeCanvas: MakeCanvas,
): PatternRaster | null {
  const key = patternKey(request);
  const existing = cache.get(key);

  if (existing) return existing.raster;

  const bucket = zoomBucket(request.pxPerMetre);

  const raster = renderSurfacePattern(
    request.outline,
    request.material,
    { origin: request.origin, rotation: request.rotation },
    request.elementId,
    // The bucket's scale, never the raw zoom — that substitution is the whole point of the
    // cache, and doing it here rather than at the call site is what keeps it impossible to skip.
    { pxPerMetre: bucketScale(bucket), makeCanvas, light: request.light },
  );

  if (!raster) return null;

  cache.set(key, { raster, bucket });

  return raster;
}

/* ---------------------------------------------------------------- test seams */

export function clearPatternCache(): void {
  cache.clear();
}

export function patternCacheSize(): number {
  return cache.size;
}

/** Whether a request would be served without drawing. Only the tests need to ask. */
export function patternCacheHas(request: PatternRequest): boolean {
  return cache.has(patternKey(request));
}

/** Hit rate and occupancy, for the dev HUD. Nothing in the app reads this. */
export function patternCacheStats() {
  return cache.stats;
}
