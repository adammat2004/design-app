import {
  geometryIsLegal,
  geometryOutline,
  polygonsIntersect,
  stepFlight,
  SYMBOLS,
  type DesignElement,
  type MaterialId,
  type PlanGeometry,
  type Point,
  type SymbolId,
} from '@garden-studio/schema';
import type { DesignConstraints } from './constraints.js';
import type { DesignFrame } from './layout/frame.js';

/**
 * Where a generated concept changes level, and the flight that serves it.
 *
 * **Nothing here infers a slope.** The site model has no ground surface — see `plan/levels.ts` for
 * why — so this cannot and must not look at a plot and decide it falls to the north. What it does
 * is the opposite: a raised terrace is a *design move*, chosen for the same kind of reason a formal
 * template is chosen, and the level it sits at is stated rather than discovered.
 *
 * The move itself is one of the oldest in garden design: lift the terrace off the house by a step
 * or two so it reads as a room rather than as paving, and drop to the lawn down a flight across its
 * full width. It is worth having precisely because it is the thing a flat plan cannot express.
 */

/** How far a raised terrace is lifted. Two risers, which is the classic and the least fussy. */
const TERRACE_RISE = 0.34;

/** Metres of going per tread. 350 mm is comfortable and is what a garden flight is built to. */
const TREAD_DEPTH = 0.35;

/** A flight narrower than this is a fire escape; wider than this and it is a ramp. */
const STEP_WIDTH_MIN = 1.2;
const STEP_WIDTH_MAX = 2.4;

/**
 * Whether this concept lifts its terrace, and by how much.
 *
 * Restrained on purpose, and gated on budget before anything else: a level change is retaining, and
 * retaining is the single most expensive thing per square metre in a garden. A concept that quietly
 * raised its terrace on a low budget would be misreporting what it costs to build by a wide margin.
 *
 * Formal takes it because a raised terrace is half of what makes a formal garden formal. Modern
 * takes it on a dear budget, where the crisp upstand is the point. Everything else stays on grade —
 * which is most concepts, and is the right default for a garden nobody has surveyed.
 */
export function terraceRise(constraints: DesignConstraints): number {
  if (constraints.budget === 'low' || constraints.budget === 'medium') return 0;
  if (constraints.style === 'formal') return TERRACE_RISE;
  if (constraints.style === 'modern' && constraints.budget === 'premium') return TERRACE_RISE;

  return 0;
}

/**
 * What a raised terrace is held back by, or `null` for a plain upstand in its own paving.
 *
 * Both are real answers and the second is the commoner one, which is why it is the fallback rather
 * than a failure: a stone terrace retained in its own stone is how most of them are built. A
 * material here is a deliberate contrast — the wall reading as a different thing from the floor it
 * carries — and that is a style decision, so it is made on the same axis every other one is.
 */
export function retainingFor(constraints: DesignConstraints): MaterialId | null {
  if (constraints.style === 'formal') return 'walling-stone';
  if (constraints.style === 'cottage') return 'brick-walling';
  if (constraints.style === 'modern') return 'rendered-block';

  return null;
}

export interface StepsOptions {
  frame: DesignFrame;
  rise: number;
  boundary: Point[];
  houseRing: Point[] | null;
  obstacles: Point[][];
  nextId: () => string;
}

/**
 * A flight down from the raised terrace's outer edge, or `null` where one will not fit.
 *
 * Placed **flush** against the terrace rather than overlapping it or standing off: two rectangles
 * sharing an edge exactly do not intersect by `polygonsIntersect`, which tests for a strict
 * crossing, so a flush flight satisfies the concept suite's pairwise-disjointness rule without a
 * fudge factor. Standing it off by a token gap would draw a garden where you step over a crack.
 *
 * The **depth is the going**, not a constant: a flight of three treads at 350 mm each is 1.05 m
 * deep, and one of five is 1.75 m. So the drawn footprint and the drawn nosings come from the same
 * rise, and there is nothing for them to disagree about.
 */
export function stepsFromTerrace(
  terrace: DesignElement,
  options: StepsOptions,
): DesignElement | null {
  const { frame, rise, boundary, houseRing, obstacles, nextId } = options;

  const flight = stepFlight(rise);
  if (!flight) return null;

  const local = geometryOutline(terrace.shape).map((point) => frame.toLocal(point));
  if (local.length < 3) return null;

  const uMax = Math.max(...local.map((point) => point.u));
  const vMin = Math.min(...local.map((point) => point.v));
  const vMax = Math.max(...local.map((point) => point.v));

  const width = Math.max(STEP_WIDTH_MIN, Math.min(STEP_WIDTH_MAX, vMax - vMin));
  // Refuse rather than draw a flight wider than the terrace it comes off.
  if (width > vMax - vMin + 1e-6) return null;

  const depth = flight.risers * TREAD_DEPTH;
  const symbol: SymbolId = 'steps';

  const shape: PlanGeometry = {
    kind: 'rect',
    centre: frame.toWorld(uMax + depth / 2, (vMin + vMax) / 2),
    width,
    depth,
    /*
     * The wall's bearing, never the house's rotation: a flight off the terrace runs parallel to the
     * wall the terrace was set out from, and a custom outline or a rotated house both come out
     * right only through the frame. Same rule every placed rectangle here follows.
     */
    rotation: frame.wallBearing,
  };

  if (!geometryIsLegal(shape, boundary)) return null;
  if (houseRing && polygonsIntersect(geometryOutline(shape), houseRing)) return null;

  const ring = geometryOutline(shape);
  if (obstacles.some((obstacle) => polygonsIntersect(ring, obstacle))) return null;

  return {
    id: nextId(),
    category: 'structure',
    role: 'feature',
    name: 'Steps',
    shape,
    zone: terrace.zone,
    material: terrace.material,
    symbol,
    height: SYMBOLS[symbol].height,
    /*
     * The flight climbs what the terrace is raised by, which is what makes the drawn nosings and
     * the level change one fact rather than two. `drawSteps` reads this and nothing else.
     */
    elevation: rise,
  };
}
