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
