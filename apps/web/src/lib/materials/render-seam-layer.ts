import { boundingBox, type Point } from '@garden-studio/schema';
import { SHADOW_TONE } from './light';
import type { DrawPass, MakeCanvas, PatternCanvas, PatternContext } from './render-surface-pattern';

/**
 * The shade where one surface meets another, drawn as one layer.
 *
 * ```
 *   feature outlines ──▶ fill OPAQUE ──▶ blur ──▶ punch the interiors back out
 *   (beds, patios,          │                              │
 *    paths, gravel)         │  a soft halo round each      │  leaving only the band
 *                           ▼  shape, inside and out       ▼  on the ground OUTSIDE
 *                    clip to the boundary ──▶ ONE composite at SEAM_SHADE_OPACITY
 * ```
 *
 * ## What it is for
 *
 * In a photograph of a garden, every edge is darker than the two things it separates: soil sits
 * below the turf beside it, a slab has a shadow gap round it, foliage overhangs the ground at its
 * own edge. It is ambient occlusion, and its absence is why a plan's surfaces look like coloured
 * paper laid side by side rather than like materials meeting. We had **none of it anywhere** —
 * `CATEGORY_EDGES` gives a lawn and a paved area `null`, so a lawn meeting paving got no mark from
 * either side.
 *
 * ## Why it cannot live in the surface painter
 *
 * `drawCutEdge` strokes a surface's *own* outline inside its *own* clip, which is the only thing a
 * per-surface raster can do: every surface here is rasterised independently and clipped to itself,
 * and that independence is the best property the renderer has — it is why moving one element
 * invalidates nothing else. A mark that belongs to the ground *outside* a bed is by definition on
 * its neighbour's raster, so drawing it there would put every surface's neighbours in every
 * surface's cache key. The paving kerb was tried that way once and drew a line down the seam
 * between two abutting patios, for exactly this reason.
 *
 * So, like the cast shadows, it gets a layer of its own: one pass over outlines the scene has
 * already resolved, composited once.
 *
 * ## Why opaque then composited once
 *
 * Two beds sharing an edge are one seam, not two. Drawing translucent bands in sequence would
 * double-darken wherever they meet, which is precisely the place the eye is looking. Same rule,
 * same reason, as `SHADOW_TONE`.
 */

export interface SeamRaster {
  canvas: PatternCanvas;
  originMetres: Point;
  pxPerMetre: number;
  widthPx: number;
  heightPx: number;
}

/**
 * How far the shade reaches from the edge, in metres.
 *
 * Small on purpose. This is contact shade, not a shadow: it says two materials meet here, and at
 * more than a hand's width it stops reading as a join and starts reading as a stain around
 * everything on the plan.
 */
export const SEAM_SHADE_METRES = 0.18;

/** How dark the band sits. Below the cast-shadow layer, because an edge is not a shadow. */
export const SEAM_SHADE_OPACITY = 0.22;

/** The same cap the shadow layer uses, and for the same reason. */
const MAX_RASTER_PX = 4096;

export function renderSeamLayer(
  outlines: Point[][],
  boundary: Point[],
  pass: DrawPass & { makeCanvas: MakeCanvas },
): SeamRaster | null {
  const rings = outlines.filter((ring) => ring.length >= 3);
  if (rings.length === 0 || boundary.length < 3) return null;

  const box = boundingBox(boundary);
  if (box.width <= 0 || box.length <= 0 || pass.pxPerMetre <= 0) return null;

  const scale = Math.min(pass.pxPerMetre, MAX_RASTER_PX / box.width, MAX_RASTER_PX / box.length);
  const widthPx = Math.max(1, Math.ceil(box.width * scale));
  const heightPx = Math.max(1, Math.ceil(box.length * scale));

  const canvas = pass.makeCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (!context) return null;

  /*
   * No blur, no layer. A hard band round every bed is a cartoon outline — worse than the flat
   * meeting it replaces — so the honest answer where `filter` is unavailable is to draw nothing.
   */
  if (typeof context.filter !== 'string') return null;

  const originMetres = { x: box.minX, y: box.minY };
  const toPx = (point: Point): Point => ({
    x: (point.x - originMetres.x) * scale,
    y: (point.y - originMetres.y) * scale,
  });

  context.save();
  tracePath(context, boundary, toPx);
  context.clip();

  context.filter = `blur(${SEAM_SHADE_METRES * scale}px)`;
  context.fillStyle = SHADOW_TONE;
  for (const ring of rings) {
    tracePath(context, ring, toPx);
    context.fill();
  }
  context.filter = 'none';

  /*
   * The inside comes back out, un-blurred, so what is left is the half of each halo that fell on
   * the neighbouring ground. Punching with the sharp outline rather than a blurred one is what
   * keeps the band's inner edge exactly on the surface's own boundary — the drawn edge of a bed
   * stays where the geometry says it is, and only the ground beside it darkens.
   */
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = '#000';
  for (const ring of rings) {
    tracePath(context, ring, toPx);
    context.fill();
  }

  context.restore();

  return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
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
