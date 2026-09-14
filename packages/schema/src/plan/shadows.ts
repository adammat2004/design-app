import type { Point } from '../geometry/primitives.js';
import type { BoundaryRun } from './boundary-styles.js';
import { elementOutline, type DesignElement } from './concepts.js';
import { castsShadow, heightFor, houseHeight, MIN_SHADOW_HEIGHT } from './heights.js';
import { isTreeSymbol, resolveSymbol } from './symbols.js';
import { rectToPolygon } from '../geometry/shapes.js';
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

/**
 * What kind of thing is casting, which decides how the shadow is *drawn* rather than where it goes.
 *
 * `PRESENTATION_SHADOW_SOFTNESS` was a single number applied to everything, and it is the correct
 * penumbra for a **hard** occluder: the sun subtends about half a degree, so the blur at the ground
 * is roughly distance × 0.009. A brick wall is a hard occluder. A tree is not — it is a porous
 * canopy, light comes through the leaves, and its shadow is the softest and lightest thing in a real
 * garden photograph. One constant served both, and every tree on the plan cast a crisp dark disc.
 *
 * Only two values, and the cap is deliberate: the shadow layer is drawn into a raster that reaches
 * 4096² (about 67 MB), and each character costs a blur pass. Two is what the picture needs and what
 * the memory allows; see `render-shadow-layer.ts`.
 */
export type ShadowCharacter = 'built' | 'foliage';

/** Something with height, and therefore a shadow. */
export interface ShadowOccluder {
  /** World metres, already tessellated. */
  outline: Point[];
  /** Metres, already resolved through `heightFor`. */
  height: number;
  /** Height of the underside of a canopy or beam; absent for solid objects. */
  baseHeight?: number;
  /**
   * How the shadow is drawn. Absent means `built`, so every existing caller is unchanged.
   *
   * Note this is presentation, not geometry: `projectShadow` never reads it, and where the shadow
   * falls is the sun's business alone.
   */
  character?: ShadowCharacter;
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
  if (height + 1e-9 < MIN_SHADOW_HEIGHT) return null;

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
 * from `houseHeight` — its storeys — rather than the manifest.
 *
 * Hidden elements are skipped: `hidden` means the user has taken it out of the drawing, and a
 * thing you cannot see casting a shadow you can is the kind of unexplainable artifact that makes
 * people stop trusting the plan.
 */
export function shadowOccluders(
  elements: DesignElement[],
  house: HouseFootprint | null,
  /**
   * The property's own sides, from `boundaryRuns(site)`.
   *
   * Optional, so every existing caller is unchanged. Given, each side casts a shadow of its own
   * real height — which matters more than any single element, because a boundary is the one thing
   * that runs the whole length of the garden: a 1.8 m wall on the south side shades a strip of
   * everything, and drawing that strip is most of what "will this bed get any sun" means.
   *
   * An `open` boundary resolves to a height of zero and is filtered here rather than special-cased
   * downstream — nothing is built there, so nothing casts.
   */
  boundaries: BoundaryRun[] = [],
): ShadowOccluder[] {
  const occluders: ShadowOccluder[] = [];

  if (house) {
    const outline = housePolygon(house);
    if (outline.length >= 3) occluders.push({ outline, height: houseHeight(house) });
  }

  for (const run of boundaries) {
    if (run.height < MIN_SHADOW_HEIGHT || run.thickness <= 0) continue;

    /*
     * A thin quad along the run rather than the polygon's edge, because `projectShadow` sweeps a
     * footprint and an edge has no area to sweep. The inward direction does not matter here: the
     * band is only a few centimetres deep and the shadow is metres long, so which side of the
     * line it is grown from is invisible in the result.
     */
    const dx = run.end.x - run.start.x;
    const dy = run.end.y - run.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    const nx = (-dy / length) * run.thickness;
    const ny = (dx / length) * run.thickness;

    occluders.push({
      outline: [
        run.start,
        run.end,
        { x: run.end.x + nx, y: run.end.y + ny },
        { x: run.start.x + nx, y: run.start.y + ny },
      ],
      height: run.height,
      // A hedge is a boundary made of plants, and its shadow behaves like one.
      ...(run.kind === 'hedge' ? { character: 'foliage' as const } : {}),
    });
  }

  for (const element of elements) {
    if (element.hidden) continue;
    if (!castsShadow(element)) continue;
    // A bed is ground with separate plants on it, not a solid wall of foliage.
    if (
      element.category === 'planting-bed' &&
      element.shape.kind !== 'point' &&
      element.material !== 'hedging' &&
      element.height === undefined
    )
      continue;

    // An open pergola casts the shadows of its posts and slats, not a solid roof.
    if (element.symbol === 'pergola' && element.shape.kind === 'rect') {
      const shape = element.shape;
      const radians = (shape.rotation * Math.PI) / 180;
      const at = (x: number, y: number) => ({
        x: shape.centre.x + x * Math.cos(radians) - y * Math.sin(radians),
        y: shape.centre.y + x * Math.sin(radians) + y * Math.cos(radians),
      });
      const height = heightFor(element);
      for (const x of [-shape.width / 2 + 0.075, shape.width / 2 - 0.075]) {
        for (const y of [-shape.depth / 2 + 0.075, shape.depth / 2 - 0.075]) {
          occluders.push({
            outline: rectToPolygon({
              centre: at(x, y),
              width: 0.15,
              depth: 0.15,
              rotation: shape.rotation,
            }),
            height,
          });
        }
      }
      const count = Math.max(2, Math.ceil(shape.width / 0.35));
      for (let i = 0; i <= count; i += 1) {
        occluders.push({
          outline: rectToPolygon({
            centre: at(-shape.width / 2 + (shape.width * i) / count, 0),
            width: 0.075,
            depth: shape.depth,
            rotation: shape.rotation,
          }),
          height,
          baseHeight: Math.max(0, height - 0.15),
        });
      }
      continue;
    }

    const outline = elementOutline(element);
    if (outline.length < 3) continue;

    const symbol = resolveSymbol(element);
    /*
     * A raised surface stands on a plinth of its own footprint, so its top is its elevation plus
     * whatever it is in itself — and the plinth is solid from the ground up, which is why this adds
     * to `height` rather than setting `baseHeight`. That distinction is the whole of it: a raised
     * terrace at 450 mm casts the shadow of a 450 mm wall round its edge, where a `baseHeight` of
     * 450 would say the terrace floats and casts nothing at all.
     *
     * A **sunken** area casts nothing. The thing that would shade it is the ground standing proud
     * around it, and a local elevation model has no ground to make an occluder out of — so the
     * honest answer is no shadow rather than an invented one.
     */
    const raised = Math.max(0, element.elevation ?? 0);
    const height = heightFor(element) + raised;

    /*
     * Foliage is a tree, a hedge, or the planting that got past the filter above — which by that
     * point means a bed with a stated height or a point-shaped one, both of which are a mass of
     * leaves rather than a wall. Everything else is built: sheds, pergola posts, raised terraces,
     * walls, the house.
     */
    const foliage =
      (symbol !== null && isTreeSymbol(symbol)) ||
      element.material === 'hedging' ||
      element.category === 'planting-bed';

    occluders.push({
      outline,
      height,
      ...(symbol && isTreeSymbol(symbol) ? { baseHeight: height * 0.45 } : {}),
      ...(foliage ? { character: 'foliage' as const } : {}),
    });
  }

  return occluders;
}
