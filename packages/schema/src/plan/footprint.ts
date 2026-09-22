import type { DesignElement } from './concepts.js';
import { geometryIsLegal, type PlanGeometry } from './features.js';
import type { Point } from '../geometry/primitives.js';
import { isTreeSymbol, resolveSymbol } from './symbols.js';

/**
 * What a thing occupies for the purposes of being legal, as against what it is drawn as.
 *
 * For everything in a garden these are the same shape and this module has nothing to say. For a
 * **tree** they are not, and the difference is the difference between our plans and a designed one.
 *
 * A tree's `shape` is a point with the radius of its **canopy**, because that is what the drawing,
 * the schedule and the shadow model all need. Treating that circle as the thing that must fit
 * inside the boundary and clear of everything else means a canopy may never cross a fence or reach
 * over a patio — so every tree in every generated plan sits marooned in open ground, and the move
 * that gives a real garden its enclosure and its dappled terrace is unavailable. A canopy is not a
 * wall: it is the part of the tree that is allowed to be over things.
 *
 * What genuinely occupies the ground is the **trunk**. That is what you cannot build on, cannot
 * pave over and cannot plant another tree inside, and it is what the boundary rule should be about:
 * a tree is in this garden if its trunk is.
 *
 * ## What this is not
 *
 * It is not a licence for the canopy to go anywhere. Whether a canopy may overlap a *particular*
 * thing is a composition question with different answers — over paving yes, through a shed no,
 * through another tree no — and that belongs to the generator's obstacle rules, which can see what
 * the other thing is. This module answers only the one question that is the same everywhere: what
 * shape is this element for a containment test.
 *
 * Nothing about the document changes: `shape.radius` is still the canopy, still what is stored,
 * still what the user drags. The trunk is derived every time, for the same reason zones, edging
 * runs and retaining faces are.
 */

/**
 * The trunk, as a fraction of the canopy it carries.
 *
 * Generous rather than botanical — a real trunk under a 4 m crown is nearer a twentieth of it —
 * because this is the space a tree *takes*, which includes the root flare and the ring you would
 * not pave right up to. A 4 m canopy comes out at half a metre.
 *
 * Deliberately a different number from the renderer's `TRUNK_RADIUS_RATIO`, which sizes the dot
 * drawn under a canopy sprite and answers to legibility rather than to occupancy.
 */
export const TRUNK_FOOTPRINT_RATIO = 0.12;

/** No trunk is smaller than this, however small the canopy a young tree is drawn with. */
export const MIN_TRUNK_RADIUS = 0.15;

/** Whether this element is one whose canopy is allowed to overhang things. */
export function isCanopy(element: DesignElement): boolean {
  if (element.shape.kind !== 'point') return false;
  const symbol = resolveSymbol(element);
  return symbol !== null && isTreeSymbol(symbol);
}

/**
 * The trunk under a canopy of this size. The one place the ratio is applied.
 *
 * Taken by the generator, which is choosing where to *put* a tree and so has a canopy in hand
 * rather than an element, and by `legalFootprint`, which has an element. Two callers, one rule —
 * or the placer and the editor would disagree about how close to a fence a tree may stand.
 */
export function trunkFootprint(canopy: PlanGeometry): PlanGeometry {
  if (canopy.kind !== 'point') return canopy;

  return {
    kind: 'point',
    at: canopy.at,
    radius: Math.max(MIN_TRUNK_RADIUS, canopy.radius * TRUNK_FOOTPRINT_RATIO),
  };
}

export function legalFootprint(element: DesignElement): PlanGeometry {
  if (!isCanopy(element)) return element.shape;

  return trunkFootprint(element.shape);
}

/**
 * Whether this element may exist where it is: `geometryIsLegal`, asked about the right shape.
 *
 * Every caller that has an *element* should use this rather than reaching for `element.shape`, or
 * the four places that decide legality — the editor's drag, the assistant's planner, the
 * generator's placer and the server's validator — will disagree about trees, and the disagreement
 * shows up as the editor refusing a tree the generator drew.
 */
export function elementIsLegal(element: DesignElement, boundary: Point[]): boolean {
  return geometryIsLegal(legalFootprint(element), boundary);
}
