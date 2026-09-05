import type { Point } from '@garden-studio/schema';

/**
 * The property drawn as a building and an enclosure rather than as two outlines.
 *
 * Pure geometry and constants shared by the Konva canvases and the plan composer, like
 * `structures.ts`. Nothing here is geometry of record: the house's outline and the boundary are
 * exactly what they were, and this decides only how thick the wall is drawn and where the fence
 * throws its shade.
 */

/** How thick the house's external wall is drawn, in metres. A cavity wall is about this. */
export const WALL_THICKNESS = 0.3;

/**
 * How far the house's shadow reaches onto the garden, in metres, and how dark it is.
 *
 * A drawing convention in the contact-shadow class, not a solar claim: fixed in depth, never scaled
 * by `HOUSE_HEIGHT`, and drawn whether or not the plan knows where on Earth it is. It says "this
 * building stands up out of the ground", which every plan needs to say — where the *cast* layer,
 * the one that says where the shade falls at four o'clock, stays gated on `site.location`.
 *
 * This is the strongest single cue that the house is a building rather than another garden
 * surface, and it replaces the one that used to do that job badly: the interior was tiled with a
 * photograph of pale oak flooring, which read as a very large deck and made the house the
 * brightest, most textured object in a drawing whose subject is the garden.
 */
export const HOUSE_SHADOW_OFFSET = 0.45;
export const HOUSE_SHADOW_ALPHA = 0.16;

/**
 * The house's footprint, pushed away from the light.
 *
 * An offset copy rather than a projection. `projectShadow` in `packages/schema` does the real
 * thing — base, cap and the quads swept between — and is what the cast layer uses; this is the
 * tight dark edge at the base of the wall, so a translation is not an approximation of it but a
 * different mark entirely, which is why the two coexist without looking muddy.
 */
export function houseGroundShadow(outline: Point[], light: Point): Point[] {
  return outline.map((point) => ({
    x: point.x - light.x * HOUSE_SHADOW_OFFSET,
    y: point.y - light.y * HOUSE_SHADOW_OFFSET,
  }));
}

/** How far the fence's shade reaches into the garden, in metres. A convention, not a solar claim. */
export const FENCE_SHADE_DEPTH = 0.35;

/** The kerb drawn outside the street edge, and the word "Street" beyond it, in metres. */
export const STREET_KERB_OFFSET = 0.6;
export const STREET_LABEL_OFFSET = 1.4;

/**
 * The strips of shade along the fence panels that face away from the light.
 *
 * One quad per edge whose *inward* normal points away from the sun — the panels the sun is behind.
 * A drawing convention in the contact-shadow class: proportional to nothing, fixed in depth, and
 * lit by whichever light the pass is lit by, so it agrees with the cast layer when there is one.
 * Returned unmerged; corners overlap by a sliver, which at the alpha these are drawn at does not
 * show.
 */
export function fenceShadeBands(
  boundary: Point[],
  light: Point,
  depth = FENCE_SHADE_DEPTH,
): Point[][] {
  if (boundary.length < 3) return [];

  // Which way is "in" depends on the winding; the signed area says which.
  let twice = 0;
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  const clockwise = twice > 0;

  const bands: Point[][] = [];

  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    // Inward normal: the left-hand normal for a clockwise ring in this y-down frame.
    const inward = clockwise
      ? { x: -dy / length, y: dx / length }
      : { x: dy / length, y: -dx / length };

    if (inward.x * light.x + inward.y * light.y >= 0) continue;

    bands.push([
      a,
      b,
      { x: b.x + inward.x * depth, y: b.y + inward.y * depth },
      { x: a.x + inward.x * depth, y: a.y + inward.y * depth },
    ]);
  }

  return bands;
}
