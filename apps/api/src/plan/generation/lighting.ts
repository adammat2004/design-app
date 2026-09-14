import {
  geometryFitsInside,
  geometryIsLegal,
  isTreeSymbol,
  resolveSymbol,
  SYMBOLS,
  type DesignElement,
  type MaterialId,
  type Point,
  type SymbolId,
} from '@garden-studio/schema';
import { materialFor } from './archetypes.js';
import type { DesignConstraints } from './constraints.js';

/**
 * A lighting scheme, composed rather than scattered.
 *
 * Pure, and pure for the same reason `furnish` is: every fitting goes at a position derived from
 * something already placed — beside a tree, along a path — so there is nothing to sample and no
 * SQL to run. It is the last pass in a concept because that is what lighting is: the layer a
 * garden is finished with.
 *
 * ## What it does not do, deliberately
 *
 * **No wall lights.** The obvious move is a pair either side of the garden door, and it is left to
 * the user. A wall light is mounted *on* the building, so a generated one would be the first thing
 * this generator ever placed inside the house footprint — and `geometryClearsHouse` being true of
 * everything the generator emits is a guarantee worth more than the fitting. The symbol is in the
 * palette and a user can hang one wherever they like.
 *
 * **No recessed lights.** They belong in steps and in a deck edge, and steps are not in the model
 * yet. Placing them anywhere else would be decoration rather than a scheme.
 *
 * **Nothing on a low budget, unless it was asked for by name.** Lighting is a real cost with a real
 * trench in it, and a low-budget concept that quietly specified fourteen fittings would be
 * misreporting what it costs. That is a default, though, not a rule about what is possible: a brief
 * that ticked "Garden lighting" has said it will pay for it, and returning a dark garden anyway
 * would be the brief having no force. `constraints.wantsLighting` is the only thing that lifts it.
 */

/** Uplights, then bollards. A garden with more fittings than plants is a car park. */
const MAX_UPLIGHTS = 5;
const MAX_BOLLARDS = 8;

/** How far a spike sits from the trunk it lights: clear of the canopy circle, and aimed back at it. */
const UPLIGHT_STANDOFF = 0.4;

/** A path shorter than this reads as a step across, not as a route worth lighting. */
const MIN_LIT_PATH = 4;

/** Bollards are spaced generously — a close-set run reads as an airport rather than a garden. */
const BOLLARD_SPACING = 4;

/** Clear of the path's own edge, so the fitting stands in the planting rather than on the paving. */
const BOLLARD_OFFSET = 0.35;

export interface LightingOptions {
  constraints: DesignConstraints;
  /** Which concept this is, so the three differ in finish rather than by accident. */
  index: number;
  boundary: Point[];
  /** The custom redesign area, or null when the user drew none. */
  scope: Point[] | null;
  nextId: () => string;
}

/**
 * Every fitting this concept specifies.
 *
 * Returns `[]` on an unasked-for low budget and on a plan with nothing worth lighting, which is the
 * common case and must stay cheap: a concept with no trees and no long path gets no lighting rather
 * than a token fitting placed to prove the feature exists.
 */
export function lightingScheme(
  elements: DesignElement[],
  options: LightingOptions,
): DesignElement[] {
  const { constraints, boundary, scope, index } = options;
  if (constraints.budget === 'low' && !constraints.wantsLighting) return [];

  const material = materialFor('lighting', constraints, index);
  const lights: DesignElement[] = [];

  for (const light of uplights(elements, options, material)) {
    if (lights.length >= MAX_UPLIGHTS) break;
    lights.push(light);
  }

  for (const light of bollards(elements, options, material)) {
    if (lights.length >= MAX_UPLIGHTS + MAX_BOLLARDS) break;
    lights.push(light);
  }

  /*
   * One legality pass over the lot, rather than per fitting inside each helper. Lighting is not
   * checked against obstacles — a spike light standing in a bed among the planting is the whole
   * point of one, and treating it as an obstacle would push the planting away from it — but it
   * still may not fall outside the fence, which is the one rule that binds everything on the plan.
   *
   * The redesign area rides along here for the same reason: a fitting is *offset* from the thing it
   * lights — an uplight sits clear of its tree's canopy, a bollard beside the path's edge — so a
   * tree or a path on the edge of the drawn area throws its fitting outside it.
   */
  return lights.filter(
    (light) =>
      geometryIsLegal(light.shape, boundary) &&
      (scope === null || geometryFitsInside(light.shape, scope)),
  );
}

/**
 * A spike light at the foot of each tree.
 *
 * The single most recognisable thing garden lighting does, and the reason it is worth doing first:
 * a tree uplit from below is what a lighting scheme is *for*, where a bollard is only a path made
 * safe. Placed just outside the canopy circle rather than under it, because a spike buried in the
 * crown lights the underside of the leaves a foot above it and nothing else.
 */
function* uplights(
  elements: DesignElement[],
  options: LightingOptions,
  material: MaterialId,
): Generator<DesignElement> {
  const symbol: SymbolId = 'light-spike';
  const spec = SYMBOLS[symbol];
  const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.06;

  for (const element of elements) {
    const treeSymbol = resolveSymbol(element);
    if (!treeSymbol || !isTreeSymbol(treeSymbol)) continue;
    if (element.shape.kind !== 'point') continue;

    /*
     * Towards the top-left of the tree, which is a convention rather than a claim: the fitting has
     * to be on *some* side and the plan's own drawing light comes from there, so a viewer reads the
     * spike as lighting the face of the tree they can see.
     */
    const standoff = element.shape.radius + UPLIGHT_STANDOFF;
    const at: Point = {
      x: element.shape.at.x - standoff * Math.SQRT1_2,
      y: element.shape.at.y - standoff * Math.SQRT1_2,
    };

    yield {
      id: options.nextId(),
      category: 'lighting',
      role: 'feature',
      name: spec.label,
      shape: { kind: 'point', at, radius },
      zone: element.zone,
      material,
      symbol,
      height: spec.height,
    };
  }
}

/**
 * Bollards down the longer paths, offset into the planting beside them.
 *
 * Only the paths worth lighting: `MIN_LIT_PATH` keeps a two-metre hop off the terrace from
 * sprouting a pair of posts, which is the failure mode of doing this by rule rather than by eye.
 */
function* bollards(
  elements: DesignElement[],
  options: LightingOptions,
  material: MaterialId,
): Generator<DesignElement> {
  const symbol: SymbolId = 'light-bollard';
  const spec = SYMBOLS[symbol];
  const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.08;

  for (const element of elements) {
    if (element.shape.kind !== 'polyline') continue;

    const { points, width } = element.shape;
    const offset = width / 2 + BOLLARD_OFFSET + radius;
    const total = pathLength(points);
    if (total < MIN_LIT_PATH) continue;

    // Started half a spacing in, so a run never plants a bollard on the doorstep it begins at.
    let side = 1;
    for (let along = BOLLARD_SPACING / 2; along < total; along += BOLLARD_SPACING) {
      const found = pointAlong(points, along);
      if (!found) continue;

      const at: Point = {
        x: found.at.x - found.normal.x * offset * side,
        y: found.at.y - found.normal.y * offset * side,
      };
      // Alternating, so a path is lit from both sides without doubling the count.
      side = -side;

      yield {
        id: options.nextId(),
        category: 'lighting',
        role: 'feature',
        name: spec.label,
        shape: { kind: 'point', at, radius },
        zone: element.zone,
        material,
        symbol,
        height: spec.height,
      };
    }
  }
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/** The point a given distance along a polyline, and the unit normal to it there. */
function pointAlong(points: Point[], distance: number): { at: Point; normal: Point } | null {
  let remaining = distance;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;

    if (remaining <= length) {
      const t = remaining / length;
      return {
        at: { x: a.x + dx * t, y: a.y + dy * t },
        normal: { x: -dy / length, y: dx / length },
      };
    }
    remaining -= length;
  }

  return null;
}
