import type { Point } from '@garden-studio/schema';
import { LIGHT_DIRECTION } from '../light';
import { moduleRandom } from '../prng';

/**
 * The geometry behind the drawn symbols: a tree canopy, a fire pit, a pergola's beams.
 *
 * Pure functions returning points, with the Konva components that consume them kept separate —
 * the split this repo tests drawn output through, and the reason `elementThumbnailGeometry` exists.
 * Nothing here imports react-konva, so it can be tested in Node without a canvas at all.
 *
 * These are **symbols, not fill patterns**. A surface pattern covers a region and goes through the
 * raster cache because it is thousands of shapes; a canopy is one object of a dozen points, and
 * putting it through the same machinery would cost more than drawing it.
 */

/** How far a lobe may fall short of the nominal radius. It may never exceed it — see below. */
const LOBE_SPREAD = 0.22;

/**
 * A tree canopy as a closed ring, in world metres.
 *
 * Seeded from the element's id, so a tree keeps its shape across every redraw and every zoom —
 * the same rule the surface patterns follow, and for the same reason: a canopy that reshuffled on
 * pan would be the most obvious shimmer on the plan.
 *
 * **Every lobe is inscribed in `radius`, never outside it.** The first version let them overshoot
 * by a fifth, which reads better in isolation and is wrong: the placer erodes the feasible region
 * by exactly this radius and the validator tessellates the same circle with `circleRing`, so an
 * overshooting lobe draws a tree hanging over the fence that the geometry says is comfortably
 * inside. That is the drawing disagreeing with the model, which is the one thing this codebase
 * spends most of its effort preventing.
 */
export function canopyRing(centre: Point, radius: number, seed: string, lobes = 11): Point[] {
  const random = moduleRandom(seed, Math.round(centre.x * 100), Math.round(centre.y * 100));

  return Array.from({ length: lobes }, (_, index) => {
    const angle = (index / lobes) * Math.PI * 2;
    const reach = radius * (1 - LOBE_SPREAD * random());

    return { x: centre.x + Math.cos(angle) * reach, y: centre.y + Math.sin(angle) * reach };
  });
}

/**
 * The lit crown: the same outline, shrunk and shifted towards the light.
 *
 * A scaled copy rather than a circle laid on top — the mistake the surface renderer made first,
 * where a hard round highlight read as a separate object rather than as the top of this one
 * catching the sun. Same `LIGHT_DIRECTION` as every slab bevel, so a tree and the patio it stands
 * beside are lit from one place.
 */
export function canopyCrown(centre: Point, radius: number, seed: string, lobes = 11): Point[] {
  /*
   * Offset plus scale must stay under the canopy's *shortest* lobe (1 - LOBE_SPREAD), or the crown
   * pokes out of the shape it is meant to be lighting on whichever side the light comes from.
   */
  const offset = radius * 0.18;
  const lit = {
    x: centre.x + LIGHT_DIRECTION.x * offset,
    y: centre.y + LIGHT_DIRECTION.y * offset,
  };

  return canopyRing(lit, radius * 0.5, seed, lobes);
}

/**
 * How big to draw a canopy sprite so that its foliage stays inside the tree's radius.
 *
 * `opaqueRadiusRatio` is the catalogue's measurement of how far the sprite's opaque pixels reach
 * from its centre, as a fraction of its half-width. Drawing the sprite with a half-width of
 * `radius / ratio` puts the furthest leaf exactly on the circle the geometry uses — the same rule
 * `canopyRing` follows, for the same reason: the placer erodes by exactly this radius and the
 * validator tessellates the same circle, so a leaf past it is the drawing disagreeing with the
 * model. A sprite that stops short of its own frame is scaled *up* to reach the circle, which is
 * what keeps a tree the size the plan says it is.
 *
 * Which variant, and which way it is turned, come from the same seeded generator as the ring, so
 * a tree keeps its crown across every redraw.
 */
export function canopySpriteBox(
  centre: Point,
  radius: number,
  seed: string,
  variants: number,
  opaqueRadiusRatio: (variant: number) => number,
): { variant: number; rotation: number; halfWidth: number } {
  const random = moduleRandom(seed, Math.round(centre.x * 100), Math.round(centre.y * 100));
  const variant = Math.min(variants - 1, Math.floor(random() * variants));
  const rotation = random() * Math.PI * 2;

  // A ratio under a half would mean the model drew a dot in a big frame; treat that as the frame.
  const ratio = Math.max(0.5, opaqueRadiusRatio(variant));

  return { variant, rotation, halfWidth: radius / ratio };
}

/**
 * How far a canopy is nudged off its trunk, as a fraction of its radius, and how big the trunk is.
 *
 * The two marks that make a tree stand up.
 *
 * A canopy drawn concentric with its own point is a green disc lying on the ground — there is
 * nothing in the drawing to say the leaves are six metres above the grass. Offsetting the canopy a
 * little *away* from the light and leaving a small dark trunk mark showing on the lit side is the
 * whole trick, and it is the oldest one in landscape drawing: the eye reads the offset as parallax
 * and the trunk as the thing holding the canopy up.
 *
 * Deliberately **not** scaled by the tree's height. It is a drawing convention in the
 * contact-shadow class, not a projection — a real parallax offset would need a camera, and a plan
 * does not have one. The cast-shadow layer is where actual solar geometry lives.
 */
/*
 * The offset has to exceed the trunk's own radius, or the canopy covers the trunk completely and
 * the whole cue does nothing — which is exactly what the first numbers did: 0.08 of the radius of
 * offset against a trunk 0.10 of the radius wide, so the mark was drawn, covered, and invisible.
 * At 0.16 against 0.085 about half the trunk shows on the lit side, which is what reads.
 */
export const CANOPY_OFFSET_RATIO = 0.16;
export const TRUNK_RADIUS_RATIO = 0.085;

/** The smallest canopy, in pixels, worth drawing a trunk under. Below this it is one dark pixel. */
export const MIN_TRUNK_PX = 10;

/**
 * Where the canopy sits and where its trunk is, in pixels.
 *
 * The trunk stays on the element's own point — that is the geometry of record, the thing the placer
 * positioned and the validator checked — and the *canopy* is what moves. Getting this the wrong way
 * round would put the tree's recorded position somewhere the drawing does not show it.
 */
export function trunkAndCanopy(
  centre: Point,
  radiusPx: number,
  light: Point,
): { trunk: Point; canopy: Point; trunkRadius: number } {
  const offset = radiusPx * CANOPY_OFFSET_RATIO;

  return {
    trunk: centre,
    canopy: { x: centre.x - light.x * offset, y: centre.y - light.y * offset },
    trunkRadius: Math.max(1, radiusPx * TRUNK_RADIUS_RATIO),
  };
}

/**
 * A fire pit: the bowl's rim and a small flame.
 *
 * Returned as two rings so the caller can fill them separately. The flame is deliberately not a
 * circle — a round orange blob reads as a paddling pool at plan scale.
 */
export function firePitRings(centre: Point, radius: number): { rim: Point[]; flame: Point[] } {
  const ring = (r: number, points: number): Point[] =>
    Array.from({ length: points }, (_, index) => {
      const angle = (index / points) * Math.PI * 2;
      return { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r };
    });

  const tip = radius * 0.75;
  const waist = radius * 0.3;

  return {
    rim: ring(radius * 0.62, 16),
    flame: [
      { x: centre.x, y: centre.y - tip },
      { x: centre.x + waist, y: centre.y },
      { x: centre.x + waist * 0.45, y: centre.y + tip * 0.55 },
      { x: centre.x - waist * 0.45, y: centre.y + tip * 0.55 },
      { x: centre.x - waist, y: centre.y },
    ],
  };
}

/**
 * The beams of a pergola or the boards of a shed roof, as line segments in world metres.
 *
 * Drawn across the *shorter* side, because that is the way a real beam spans — and because it is
 * what tells a pergola from a shed at a glance without either one needing a label.
 */
export function beamLines(
  centre: Point,
  width: number,
  depth: number,
  rotation: number,
  spacing = 0.6,
): [Point, Point][] {
  const across = width <= depth;
  const span = across ? width : depth;
  const run = across ? depth : width;

  const count = Math.max(2, Math.floor(span / spacing));
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Local frame first, then rotated about the centre — the same convention as `rectToPolygon`.
  const toWorld = (x: number, y: number): Point => ({
    x: centre.x + x * cos - y * sin,
    y: centre.y + x * sin + y * cos,
  });

  return Array.from({ length: count - 1 }, (_, index) => {
    const t = ((index + 1) / count - 0.5) * span;
    const half = run / 2;

    return across
      ? ([toWorld(t, -half), toWorld(t, half)] as [Point, Point])
      : ([toWorld(-half, t), toWorld(half, t)] as [Point, Point]);
  });
}
