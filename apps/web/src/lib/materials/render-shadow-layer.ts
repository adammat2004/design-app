import {
  boundingBox,
  projectShadow,
  shadowRings,
  type Point,
  type ShadowCast,
  type ShadowOccluder,
} from '@garden-studio/schema';
import { SHADOW_TONE } from './light';
import type { DrawPass, MakeCanvas, PatternCanvas, PatternContext } from './render-surface-pattern';

/**
 * The plan's cast shadows, drawn as one layer.
 *
 * ```
 *   occluders ──▶ projectShadow ──▶ rings ──▶ fill OPAQUE into this layer
 *   (outline +     (per object,     (base,     │
 *    height)        from the sun)    sides,    │  overlaps merge because every
 *                                    cap)      │  piece is opaque — no polygon
 *                                              │  union needed anywhere
 *                                              ▼
 *                        clip to the boundary ──▶ ONE composite at SHADOW_OPACITY
 * ```
 *
 * **Why a layer at all, rather than shading each surface.** A shadow belongs to one object and
 * lands on another: a tree's shadow falls on the lawn. Every surface here is rasterised
 * independently and clipped to its own outline, and that independence is the best property the
 * renderer has — it is why moving one element invalidates nothing else. A shadow baked into its
 * neighbours' rasters would couple every element to every element near it and make a drag stutter.
 * So shadows get their own layer, drawn above the fills and below the features.
 *
 * **Why opaque then composited once.** Two overlapping shadows are one shadow. Drawing them
 * translucent one after another double-darkens the overlap, which reads instantly as a bug. See
 * `SHADOW_TONE`.
 *
 * Note this module does exactly what the surface renderer does and no more: it is handed geometry
 * that `projectShadow` already produced and it returns pixels. It measures nothing and nothing
 * downstream reads it.
 */

export type { ShadowOccluder };

export interface ShadowRaster {
  canvas: PatternCanvas;
  /** World metres — the top-left corner the raster covers. */
  originMetres: Point;
  pxPerMetre: number;
  widthPx: number;
  heightPx: number;
}

/**
 * The largest shadow raster we will allocate, per side. Same reasoning and same number as the
 * surface renderer's cap: a very large plot at a very deep zoom gets a slightly soft shadow
 * rather than a canvas the size of the garden times four hundred.
 */
const MAX_RASTER_PX = 4096;

/**
 * Rasterises every cast shadow on the plan into one image.
 *
 * `null` when there is nothing to draw — no sun, no occluders, or a boundary with no area. The
 * caller draws no shadow layer at all in that case rather than an empty one.
 *
 * The raster covers the **boundary**, not the union of the shadows. Anchoring to the plot keeps
 * the origin stable while the sun moves, which is what stops a time-of-day drag from shifting
 * every pixel of the layer sideways as its bounding box grows and shrinks.
 */
export function renderShadowLayer(
  occluders: ShadowOccluder[],
  cast: ShadowCast,
  boundary: Point[],
  pass: DrawPass & { makeCanvas: MakeCanvas },
): ShadowRaster | null {
  if (occluders.length === 0 || boundary.length < 3) return null;

  const box = boundingBox(boundary);
  if (box.width <= 0 || box.length <= 0 || pass.pxPerMetre <= 0) return null;

  const scale = Math.min(pass.pxPerMetre, MAX_RASTER_PX / box.width, MAX_RASTER_PX / box.length);

  const widthPx = Math.max(1, Math.ceil(box.width * scale));
  const heightPx = Math.max(1, Math.ceil(box.length * scale));

  const canvas = pass.makeCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (!context) return null;

  const originMetres = { x: box.minX, y: box.minY };

  drawShadowLayer(context, occluders, cast, boundary, { pxPerMetre: scale }, originMetres);

  return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
}

/**
 * Draws every shadow into a context, opaque and clipped to the boundary.
 *
 * Split from `renderShadowLayer` for the reason `drawSurfacePattern` is: jsdom returns `null`
 * from `getContext('2d')`, so anything that has to draw takes a context as an argument and the
 * tests hand it a real one from `@napi-rs/canvas`.
 *
 * The clip is not cosmetic. A shadow physically crosses the fence, but a garden plan that shades
 * next door's property is making a statement about land it does not describe — so the layer is
 * cut to the plot, which is the same clamp `borderRegions` already applies on the server.
 */
export function drawShadowLayer(
  context: PatternContext,
  occluders: ShadowOccluder[],
  cast: ShadowCast,
  boundary: Point[],
  pass: DrawPass,
  rasterOrigin: Point,
): void {
  const { pxPerMetre } = pass;

  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  context.save();

  tracePath(context, boundary, toPx);
  context.clip();

  context.fillStyle = SHADOW_TONE;

  for (const occluder of occluders) {
    const shadow = projectShadow(occluder.outline, occluder.height, cast);
    if (!shadow) continue;

    /*
     * One path per ring, filled immediately. Collecting every ring into a single path and filling
     * once would be fewer calls, but the non-zero winding rule then cancels overlapping rings
     * against each other and punches holes through the shadow wherever a side quad doubles back.
     */
    for (const ring of shadowRings(shadow)) {
      tracePath(context, ring, toPx);
      context.fill();
    }
  }

  context.restore();
}

function tracePath(context: PatternContext, ring: Point[], toPx: (point: Point) => Point): void {
  context.beginPath();

  ring.forEach((point, index) => {
    const { x, y } = toPx(point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.closePath();
}
