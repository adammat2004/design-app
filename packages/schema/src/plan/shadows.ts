import type { Point } from '../geometry/primitives.js';
import { elementOutline, type DesignElement } from './concepts.js';
import { castsShadow, heightFor, HOUSE_HEIGHT, MIN_SHADOW_HEIGHT } from './heights.js';
import { housePolygon, type HouseFootprint } from './site.js';
import type { ShadowCast } from './sun.js';

/**
 * The shape a thing's shadow takes on flat ground.
 *
 * Geometry, so it lives here rather than in the renderer — the same rule heights and the sun
 * follow. A shadow is a claim about the garden ("this corner is in shade at four o'clock"), and
 * the placer that will one day act on that claim runs on the server.
 *
 * **The pieces are returned unmerged, deliberately.** A shadow is the union of the footprint, the
 * footprint translated to where its top lands, and the quads swept between them — and computing
 * that union in TypeScript would mean a polygon-boolean dependency for a result nothing needs as
 * a single ring. Every consumer already has a better union available: the canvas gets one for
 * free by drawing the pieces opaque into one layer, and a future PostGIS query would use
 * `ST_Union`, which is the right tool there anyway.
 */

/** Something with height, and therefore a shadow. */
export interface ShadowOccluder {
  /** World metres, already tessellated. */
  outline: Point[];
  /** Metres, already resolved through `heightFor`. */
  height: number;
}

export interface ShadowGeometry {
  /** The occluder's own footprint, on the ground. */
  base: Point[];
  /** The footprint translated to where the top of the object projects. */
  cap: Point[];
  /**
   * One quad per edge, sweeping a base edge out to its cap edge.
   *
   * Roughly half of these face the sun and fall entirely inside the union — they are kept rather
   * than culled because deciding which is which needs a winding test that the opaque overlay
   * makes free. Drawing a few redundant quads costs less than getting the culling wrong and
   * punching a hole in a shadow.
   */
  sides: Point[][];
}

/**
 * How far, and which way, the top of an object projects onto the ground.
 *
 * Metres, in the plan's own frame. Multiplying the unit direction by the height is the whole of
 * the trigonometry — `lengthPerMetre` already carries the `1 / tan(altitude)` from the sun.
 */
export function shadowOffset(height: number, cast: ShadowCast): Point {
  const distance = height * cast.lengthPerMetre;

  return { x: cast.direction.x * distance, y: cast.direction.y * distance };
}

/**
 * Projects one occluder's shadow, or `null` when it does not cast one.
 *
 * `null` for three genuinely different reasons, all of which mean "draw nothing" rather than
 * "draw something degenerate": the thing is too low to cast anything worth drawing, its outline
 * is not a polygon, or the sun is high enough that the offset rounds away to nothing.
 */
export function projectShadow(
  outline: Point[],
  height: number,
  cast: ShadowCast,
): ShadowGeometry | null {
  if (outline.length < 3) return null;
  if (height < MIN_SHADOW_HEIGHT) return null;

  const offset = shadowOffset(height, cast);

  // A sun at the exact zenith casts no shadow at all. Guarding here keeps every consumer from
  // having to handle a cap that sits exactly on its own base.
  if (Math.hypot(offset.x, offset.y) < 1e-9) return null;

  const cap = outline.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));

  const sides: Point[][] = [];
  for (let i = 0; i < outline.length; i += 1) {
    const next = (i + 1) % outline.length;

    sides.push([outline[i]!, outline[next]!, cap[next]!, cap[i]!]);
  }

  return { base: outline, cap, sides };
}

/**
 * Every ring a shadow is made of, in one flat list.
 *
 * The order is base, then sides, then cap. It does not matter for an opaque overlay — that is
 * the point of drawing them opaque — but a stable order keeps rendered output reproducible,
 * which the byte-comparison tests depend on.
 */
export function shadowRings(geometry: ShadowGeometry): Point[][] {
  return [geometry.base, ...geometry.sides, geometry.cap];
}

/**
 * Everything on the plan that casts a shadow.
 *
 * Deliberately small. Only things with height cast, so paving, gravel, lawn and water all drop
 * out here rather than being projected to a zero-length shadow and discarded later — which is
 * what keeps a separate shadow layer cheap: ten to thirty occluders on a busy plan, against
 * potentially hundreds of surface modules.
 *
 * The house is included and comes first, because it is usually the largest shadow in the garden
 * and the reason the seating is where it is. It is not a `DesignElement`, so its height comes
 * from `HOUSE_HEIGHT` rather than the manifest.
 *
 * Hidden elements are skipped: `hidden` means the user has taken it out of the drawing, and a
 * thing you cannot see casting a shadow you can is the kind of unexplainable artifact that makes
 * people stop trusting the plan.
 */
export function shadowOccluders(
  elements: DesignElement[],
  house: HouseFootprint | null,
): ShadowOccluder[] {
  const occluders: ShadowOccluder[] = [];

  if (house) {
    const outline = housePolygon(house);
    if (outline.length >= 3) occluders.push({ outline, height: HOUSE_HEIGHT });
  }

  for (const element of elements) {
    if (element.hidden) continue;
    if (!castsShadow(element)) continue;

    const outline = elementOutline(element);
    if (outline.length < 3) continue;

    occluders.push({ outline, height: heightFor(element) });
  }

  return occluders;
}
