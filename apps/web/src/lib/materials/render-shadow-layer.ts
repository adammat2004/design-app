import {
  boundingBox,
  projectShadow,
  shadowRings,
  shadowOffset,
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
 * A restrained presentation penumbra, in metres; never changes the solar projection.
 *
 * This is the correct number for a **hard** occluder and nothing else: the sun subtends about half
 * a degree, so the penumbra at the ground is roughly distance × 0.009. A wall, a shed, a house.
 */
export const PRESENTATION_SHADOW_SOFTNESS = 0.06;

/**
 * And this is a tree, which is not a hard occluder at all.
 *
 * A canopy is porous — light comes through it in a thousand places — so its shadow has no crisp
 * edge and never reaches full darkness. Applying the hard-occluder number to foliage drew every
 * tree on the plan as a sharp dark disc, which is the single most obviously non-photographic thing
 * in the render. Nearly an order of magnitude softer, which sounds drastic and is still less
 * diffuse than the real thing.
 */
export const FOLIAGE_SHADOW_SOFTNESS = 0.45;

/**
 * Foliage shade is lighter as well as softer, and the lightness cannot come from a second alpha.
 *
 * The whole layer is composited once at `SHADOW_OPACITY` — that single composite is what makes two
 * overlapping shadows read as one shadow instead of doubling. Compositing two rasters at two
 * different alphas would put the double-darkening straight back wherever they crossed. A lighter
 * *tone* inside the one opaque union gets the same result with the invariant intact.
 *
 * Same blue-grey, because shaded ground outdoors is lit by the sky and sky light is blue; a shadow
 * that drifts toward neutral as it lightens reads as dirt rather than as shade.
 */
export const FOLIAGE_SHADOW_TONE = '#7c8a91';

/**
 * How much softer a shadow edge gets per metre the thing casting it stands above the ground.
 *
 * A presentation choice, like the base softness itself, and the honest reading is not the sun's
 * angular size — at these ratios the true penumbra of a six-metre house is about 3 cm, well under
 * the 6 cm the drawing already uses. It is that the further a shadow edge falls from the object
 * that made it, the more of the sky is diffusing it, and the more a hard edge there looks drawn on.
 * A kerb keeps its crisp line; a house, a tree and a shed get an edge that reads as air between the
 * object and its shadow.
 *
 * At 0.25 a 6 m house is 2.5× the base and a 0.3 m edging course is within 8% of it.
 */
export const PENUMBRA_GROWTH_PER_METRE = 0.25;

/**
 * Heights are quantised into these bands before they reach the blur, and the reason is cost.
 *
 * Every distinct softness is another opaque union, another blur and another composite over a
 * raster that reaches 4096². Three bands — ground level, garden scale, building scale — is the
 * resolution at which the difference is visible; a continuous version would be a pass per object.
 */
const HEIGHT_BANDS = [0, 1.5, 4] as const;

function heightBand(height: number): number {
  let band = 0;
  for (let index = 1; index < HEIGHT_BANDS.length; index += 1) {
    if (height >= HEIGHT_BANDS[index]!) band = index;
  }
  return band;
}

/**
 * Draw order, and it is the whole of how the overlap rule stays honest.
 *
 * Built last, so where a tree's shadow crosses a wall's the **darker** one wins. That is what
 * actually happens: the wall blocks the sun completely, and a porous canopy in front of it cannot
 * un-block it. Fixed order rather than input order means the result does not depend on which
 * occluder the scene happened to list first.
 *
 * Within a character the bands run **low to high**, so where a tree's crown shadow crosses its own
 * trunk's the softer edge is laid over the crisper one rather than under it.
 */
const CHARACTER_ORDER = ['foliage', 'built'] as const;

const TONE: Record<(typeof CHARACTER_ORDER)[number], string> = {
  foliage: FOLIAGE_SHADOW_TONE,
  built: SHADOW_TONE,
};

const SOFTNESS: Record<(typeof CHARACTER_ORDER)[number], number> = {
  foliage: FOLIAGE_SHADOW_SOFTNESS,
  built: PRESENTATION_SHADOW_SOFTNESS,
};

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
  /**
   * `softnessMetres` is a **switch, not a radius** — read this before changing a caller.
   *
   * Any value above zero turns the presentation path on; the blur actually applied then comes from
   * the occluder's own character (`PRESENTATION_SHADOW_SOFTNESS` for built, `FOLIAGE_SHADOW_SOFTNESS`
   * for foliage) and its own height (`PENUMBRA_GROWTH_PER_METRE`), because one number cannot be
   * right for both a brick kerb and a tree canopy six metres up. So passing 0.2 here does not give
   * a 0.2 m penumbra; it gives the same picture 0.06 would.
   *
   * Zero or absent takes the old single-union path: one tone, no blur, no buckets. _This reverses_
   * "zero is the plan view": both views now pass the presentation softness, because a hard-edged
   * shadow is what a shadow looks like on the moon and the plan is a drawing of a garden. The
   * hard path is kept because a context with no `filter` support falls back to it, and because a
   * caller that genuinely wants the union — a mask, a coverage measurement — should be able to ask.
   *
   * Kept as a number rather than a boolean because it is in `shadowLayerKey`, and a caller that
   * varies it should still miss the cache rather than silently reuse a raster.
   */
  pass: DrawPass & { makeCanvas: MakeCanvas; softnessMetres?: number },
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

  /*
   * The plan view takes the old path exactly: one opaque union, one tone, no blur.
   *
   * Gating the character treatment on the presentation softness rather than on a view flag is what
   * makes "2D Plan does not change" true *by construction* here rather than by inspection — the
   * plan view passes no softness, so it cannot reach any of the code below.
   */
  if (!pass.softnessMetres || pass.softnessMetres <= 0) {
    drawShadowLayer(context, occluders, cast, boundary, { pxPerMetre: scale }, originMetres);

    return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
  }

  if (typeof context.filter !== 'string') {
    // No blur available. Still better to draw a crisp shadow than none.
    drawShadowLayer(context, occluders, cast, boundary, { pxPerMetre: scale }, originMetres);

    return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
  }

  /*
   * Two buckets, one scratch canvas, reused.
   *
   * `canvas` is the accumulator and `scratch` is where a bucket's opaque union is built before it
   * is blurred in. **Two live allocations, which is what it was before** — worth being deliberate
   * about, because this raster reaches 4096² at about 67 MB and Safari has already been recorded
   * refusing a canvas at 368 MB on the export path. One canvas per bucket per stage would have been
   * the obvious way to write this and would have put five of them in flight.
   *
   *   foliage ─▶ scratch (opaque, light tone) ─▶ blur 0.45 m ─┐
   *                                                            ├─▶ accumulator ─▶ ONE composite
   *   built   ─▶ scratch (opaque, dark tone)  ─▶ blur 0.06 m ─┘     at SHADOW_OPACITY
   *
   * Built goes in second, so the darker tone covers the lighter where they cross.
   */
  const scratch = pass.makeCanvas(widthPx, heightPx);
  const scratchContext = scratch.getContext('2d');
  if (!scratchContext) {
    drawShadowLayer(context, occluders, cast, boundary, { pxPerMetre: scale }, originMetres);

    return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
  }

  const toPx = (p: Point): Point => ({
    x: (p.x - originMetres.x) * scale,
    y: (p.y - originMetres.y) * scale,
  });

  context.save();
  tracePath(context, boundary, toPx);
  context.clip();

  for (const character of CHARACTER_ORDER) {
    for (let band = 0; band < HEIGHT_BANDS.length; band += 1) {
      const bucket = occluders.filter(
        (occluder) =>
          (occluder.character ?? 'built') === character && heightBand(occluder.height) === band,
      );
      if (bucket.length === 0) continue;

      scratchContext.clearRect(0, 0, widthPx, heightPx);
      drawShadowLayer(
        scratchContext,
        bucket,
        cast,
        boundary,
        { pxPerMetre: scale },
        originMetres,
        TONE[character],
      );

      const softness =
        SOFTNESS[character] * (1 + HEIGHT_BANDS[band]! * PENUMBRA_GROWTH_PER_METRE);
      context.filter = `blur(${softness * scale}px)`;
      context.drawImage(scratch, 0, 0, widthPx, heightPx);
      context.filter = 'none';
    }
  }

  context.restore();

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
  /**
   * The tone to fill in, defaulting to the one every caller used before buckets existed.
   *
   * Set **once, outside the loop**, exactly as it always was — that is not incidental. Varying the
   * fill per occluder inside a single union is what would let two shadows stack into something
   * darker than either, so the colour is a property of the whole call rather than of any occluder
   * in it. A bucket is one call.
   */
  tone: string = SHADOW_TONE,
): void {
  const { pxPerMetre } = pass;

  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  context.save();

  tracePath(context, boundary, toPx);
  context.clip();

  context.fillStyle = tone;

  for (const occluder of occluders) {
    const baseHeight = occluder.baseHeight ?? 0;
    const offset = shadowOffset(baseHeight, cast);
    const outline =
      baseHeight === 0
        ? occluder.outline
        : occluder.outline.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
    const shadow = projectShadow(outline, occluder.height - baseHeight, cast);
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
