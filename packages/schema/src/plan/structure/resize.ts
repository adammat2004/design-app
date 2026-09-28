import {
  clipToHalfPlane,
  polygonArea,
  polygonContainsPolygon,
  type Point,
} from '../../geometry/primitives.js';
import { elementOutline, isLocked, type DesignElement, type ElementCategory } from '../concepts.js';
import { geometryOutline } from '../features.js';
import { elementIsLegal, legalFootprint } from '../footprint.js';
import { formatLength, formatLengthValue, type Unit } from '../units.js';
import { sizeForSeats } from './capacity.js';
import { structureDefinitionFor, type StructureDefinition } from './definitions.js';
import {
  sideSurroundings,
  structureSides,
  type LocalSide,
  type SideNeighbour,
  type SurroundingsContext,
} from './surroundings.js';

/**
 * Resizing a structure as a design decision, not a drag: the one rule the 3D editor, the 2D panel
 * and the assistant's planner all go through.
 *
 * ## It keeps what the structure is against
 *
 * A pergola against the back wall grows away from the wall; one flush with its terrace grows away
 * from the terrace; a free-standing gazebo grows about its middle. None of that is stored — which
 * side is against what is read from the plan at the moment of the resize (`structurePins`), for the
 * reason zones and openings are derived: a stored "attached to the house" goes stale the moment the
 * pergola is dragged into the lawn, and then every resize would pull it back towards a wall it no
 * longer touches.
 *
 * ## It says what is in the way, and what would work instead
 *
 * A resize that runs into something is never applied and never silently shrunk. It comes back
 * `blocked`, naming each thing it would run into and offering alternatives that have each been
 * checked by the same rules: the largest size that fits, or the requested size moved a little. It
 * never trims a neighbour — taking ground off a bed is a planner decision with its own undo, not a
 * side effect of typing a width.
 *
 * ## Only what the resize makes worse
 *
 * An overlap that was already there before the resize is not a conflict. Things may sit on the
 * house and the editor lets a person put a pergola over a bed by hand; refusing every later resize
 * of it because of that would punish a decision the user already made. What is refused is an overlap
 * the resize creates or grows.
 */

export interface StructureResizeRequest {
  width?: number;
  depth?: number;
  /** Size it for this many people at one table instead. Wins over width and depth. */
  seats?: number;
}

export type StructureConflict =
  | { kind: 'boundary' }
  | { kind: 'house' }
  | {
      kind: 'element';
      id: string;
      category: ElementCategory;
      name?: string;
      /** It would run into it, or — after a shrink — the thing on it would no longer fit. */
      reason: 'overlaps' | 'no-longer-fits';
    };

/**
 * A change that would work instead, already checked. Carries what it is rather than a sentence, so
 * the words can be said in the plan's own unit (`describeStructureAlternative`).
 */
export type StructureAlternative =
  | { kind: 'fit'; element: DesignElement; size: { width: number; depth: number } }
  | {
      kind: 'shift';
      element: DesignElement;
      /** Metres moved, at the requested size. */
      distance: number;
      direction: 'towards-house' | 'away-from-house' | 'sideways';
    };

export type StructurePins = Partial<Record<LocalSide, SideNeighbour>>;

export type StructureResizeResult =
  | { status: 'unsupported' }
  | { status: 'unchanged'; pins: StructurePins }
  | { status: 'ok'; element: DesignElement; clamped: boolean; pins: StructurePins }
  | {
      status: 'blocked';
      candidate: DesignElement;
      conflicts: StructureConflict[];
      alternatives: StructureAlternative[];
      clamped: boolean;
      pins: StructurePins;
    };

export type StructureResizeContext = SurroundingsContext;

/** Less than this much more overlap is rounding, not a collision. */
const OVERLAP_TOLERANCE = 0.01;
const SIZE_EPSILON = 1e-6;
/** How far a shift alternative is allowed to move the structure, and in what steps. */
const SHIFT_STEP = 0.1;
const SHIFT_LIMIT = 1;
/**
 * A shift may not leave a structure a sliver off the fence: under this it is a gap nobody can paint
 * behind, which the buildability principle marks down. Flush is fine; this or more is fine.
 */
const FENCE_CLEARANCE = 0.3;

/** What a thing is called when it has no name of its own. */
const CATEGORY_NOUN: Partial<Record<ElementCategory, string>> = {
  structure: 'another structure',
  'water-feature': 'the water feature',
  'paved-area': 'a path',
  'planting-bed': 'a planting bed',
  furniture: 'some furniture',
  lighting: 'a light',
  'existing-feature': 'an existing feature',
};

/** An alternative as a button label, in the plan's unit: "Use 4.0 × 3.5 m", "Move it 0.4 m sideways". */
export function describeStructureAlternative(
  alternative: StructureAlternative,
  unit: Unit,
): string {
  if (alternative.kind === 'fit') {
    const { width, depth } = alternative.size;
    return `Use ${formatLengthValue(width, unit)} × ${formatLength(depth, unit)}`;
  }
  const distance = formatLength(alternative.distance, unit);
  switch (alternative.direction) {
    case 'towards-house':
      return `Move it ${distance} towards the house`;
    case 'away-from-house':
      return `Move it ${distance} away from the house`;
    case 'sideways':
      return `Move it ${distance} sideways`;
  }
}

/**
 * One conflict as a sentence a person can act on — "The rear border is in the way." The editor's
 * notice and the assistant's refusal both say it, so the two never describe one clash differently.
 */
export function describeStructureConflict(conflict: StructureConflict): string {
  switch (conflict.kind) {
    case 'boundary':
      return 'It would cross the boundary.';
    case 'house':
      return 'It would run into the house.';
    case 'element': {
      const noun = conflict.name
        ? `the ${conflict.name.charAt(0).toLowerCase()}${conflict.name.slice(1)}`
        : (CATEGORY_NOUN[conflict.category] ?? 'something');
      const subject = noun.charAt(0).toUpperCase() + noun.slice(1);
      return conflict.reason === 'no-longer-fits'
        ? `${subject} would no longer fit in it.`
        : `${subject} is in the way.`;
    }
  }
}

/** What each side of the structure is against, read now. */
export function structurePins(element: DesignElement, context: SurroundingsContext): StructurePins {
  const readings = sideSurroundings(element, context);
  return Object.fromEntries(
    Object.entries(readings).map(([side, reading]) => [side, reading!.neighbour]),
  ) as StructurePins;
}

/**
 * The rect at a new size with the pinned sides held still: a side that is against something stays
 * where it is and the rect grows away from it. Pinned on neither side of an axis, or on both, it
 * grows about its centre on that axis. Rotation is untouched.
 */
export function anchoredResize(
  element: DesignElement,
  size: { width: number; depth: number },
  pins: StructurePins,
): DesignElement {
  const { shape } = element;
  if (shape.kind !== 'rect') return element;
  const dw = size.width - shape.width;
  const dd = size.depth - shape.depth;
  const sx = pins.left && !pins.right ? dw / 2 : pins.right && !pins.left ? -dw / 2 : 0;
  const sy = pins.rear && !pins.front ? dd / 2 : pins.front && !pins.rear ? -dd / 2 : 0;
  const radians = ((shape.rotation ?? 0) * Math.PI) / 180;
  const u = { x: Math.cos(radians), y: Math.sin(radians) };
  const v = { x: -Math.sin(radians), y: Math.cos(radians) };
  return {
    ...element,
    shape: {
      ...shape,
      width: size.width,
      depth: size.depth,
      centre: {
        x: shape.centre.x + u.x * sx + v.x * sy,
        y: shape.centre.y + u.y * sx + v.y * sy,
      },
    },
  };
}

/**
 * Whether something is an obstacle a structure may not grow into.
 *
 * Not the ground it stands on — a lawn, a terrace, a gravel court, a base fill — and not the
 * furniture standing in it, which moves with it. Everything with a footprint of its own is: another
 * building, a pond, a path, a bed, a tree (by its trunk: a canopy may reach over a pergola, the
 * trunk may not stand in it), a bench beside it.
 */
function isObstacle(other: DesignElement): boolean {
  if (other.hidden || isLocked(other)) return false;
  switch (other.category) {
    case 'lawn':
    case 'gravel-mulch':
      return false;
    case 'paved-area':
      // A path is in the way; a terrace is something to stand on.
      return other.shape.kind === 'polyline';
    default:
      return true;
  }
}

/** Area of `subject` inside the convex ring `clip`. Sutherland–Hodgman over each edge. */
function overlapArea(subject: Point[], clip: Point[]): number {
  if (subject.length < 3) return 0;
  const inward = clipWinding(clip);
  let ring = subject;
  for (let i = 0; i < clip.length && ring.length >= 3; i += 1) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const normal = { x: -(b.y - a.y) * inward, y: (b.x - a.x) * inward };
    ring = clipToHalfPlane(ring, a, normal);
  }
  return ring.length >= 3 ? polygonArea(ring) : 0;
}

/** +1 when the left normal of each edge points inside the ring, −1 when the right one does. */
function clipWinding(ring: Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice >= 0 ? 1 : -1;
}

/**
 * What the candidate runs into that the original did not. Empty means the resize is sound.
 */
export function structureConflicts(
  original: DesignElement,
  candidate: DesignElement,
  context: StructureResizeContext,
): StructureConflict[] {
  const conflicts: StructureConflict[] = [];
  if (context.boundary.length >= 3 && !elementIsLegal(candidate, context.boundary)) {
    conflicts.push({ kind: 'boundary' });
  }

  const before = elementOutline(original);
  const after = elementOutline(candidate);

  if (context.house && context.house.length >= 3) {
    const grown = overlapArea(context.house, after) - overlapArea(context.house, before);
    if (grown > OVERLAP_TOLERANCE) conflicts.push({ kind: 'house' });
  }

  for (const other of context.elements) {
    if (other.id === original.id) continue;
    const ring = elementOutline(other);
    const hosted =
      (other.category === 'furniture' || other.category === 'lighting') &&
      !other.hidden &&
      polygonContainsPolygon(before, ring);
    if (hosted) {
      if (!polygonContainsPolygon(after, ring)) {
        conflicts.push(elementConflict(other, 'no-longer-fits'));
      }
      continue;
    }
    if (!isObstacle(other)) continue;
    const footprint = geometryOutline(legalFootprint(other));
    const grown = overlapArea(footprint, after) - overlapArea(footprint, before);
    if (grown > OVERLAP_TOLERANCE) conflicts.push(elementConflict(other, 'overlaps'));
  }
  return conflicts;
}

function elementConflict(
  other: DesignElement,
  reason: 'overlaps' | 'no-longer-fits',
): StructureConflict {
  return {
    kind: 'element',
    id: other.id,
    category: other.category,
    ...(other.name ? { name: other.name } : {}),
    reason,
  };
}

/**
 * The size a request asks for, held to the definition's limits — **monotonically**: a structure
 * already outside the limits (a legacy plan, or an estate-scale pergola from before the limits
 * existed) may move towards them but never further away.
 */
function targetSize(
  element: DesignElement & { shape: { kind: 'rect' } },
  definition: StructureDefinition,
  request: StructureResizeRequest,
): { width: number; depth: number; clamped: boolean } {
  const { shape } = element;
  let width = request.width ?? shape.width;
  let depth = request.depth ?? shape.depth;
  if (request.seats !== undefined) {
    const need = sizeForSeats(definition, request.seats);
    // The table's long side runs along whichever side of the structure is already the longer.
    if (shape.width >= shape.depth) {
      width = need.long;
      depth = need.short;
    } else {
      width = need.short;
      depth = need.long;
    }
  }
  const { width: w, depth: d } = heldToLimits(definition, shape, { width, depth });
  return {
    width: w,
    depth: d,
    clamped: Math.abs(w - width) > SIZE_EPSILON || Math.abs(d - depth) > SIZE_EPSILON,
  };
}

/**
 * A size held to a structure's limits **monotonically**: never taken further outside them than the
 * current size already is. What a live drag of the plan's handles clamps to, and what a typed size
 * is held to, so both stop at the same place.
 */
export function heldToLimits(
  definition: StructureDefinition,
  current: { width: number; depth: number },
  size: { width: number; depth: number },
): { width: number; depth: number } {
  const held = (value: number, now: number, limits: { min: number; max: number }) =>
    Math.min(Math.max(limits.max, now), Math.max(Math.min(limits.min, now), value));
  return {
    width: held(size.width, current.width, definition.dimensions.width),
    depth: held(size.depth, current.depth, definition.dimensions.depth),
  };
}

/**
 * The refusal the AI executor and the editor give a resize past a structure's limits, or `null`.
 * Monotone, like `targetSize`: shrinking an oversized structure is always allowed.
 */
export function structureLimitRefusal(before: DesignElement, after: DesignElement): string | null {
  const definition = structureDefinitionFor(after);
  if (!definition || before.shape.kind !== 'rect' || after.shape.kind !== 'rect') return null;
  const checks: ['width' | 'depth', number, number][] = [
    ['width', before.shape.width, after.shape.width],
    ['depth', before.shape.depth, after.shape.depth],
  ];
  for (const [axis, was, now] of checks) {
    const { min, max } = definition.dimensions[axis];
    if (now > max + SIZE_EPSILON && now > was + SIZE_EPSILON) {
      return `A ${definition.label.toLowerCase()} can be at most ${max} m ${axis === 'width' ? 'wide' : 'deep'}.`;
    }
    if (now < min - SIZE_EPSILON && now < was - SIZE_EPSILON) {
      return `A ${definition.label.toLowerCase()} must be at least ${min} m ${axis === 'width' ? 'wide' : 'deep'}.`;
    }
  }
  return null;
}

/**
 * Resize a structure, or say exactly why not.
 *
 * `unsupported` for anything that is not a configurable rect; `unchanged` when the request, held to
 * the limits, is the size it already is; `ok` with the element to write; `blocked` with the
 * candidate, what it runs into, and alternatives that have each been checked.
 */
export function planStructureResize(
  element: DesignElement,
  request: StructureResizeRequest,
  context: StructureResizeContext,
): StructureResizeResult {
  const definition = structureDefinitionFor(element);
  if (!definition || element.shape.kind !== 'rect') return { status: 'unsupported' };
  const rect = element as DesignElement & { shape: { kind: 'rect' } };
  const target = targetSize(rect, definition, request);
  const pins = structurePins(element, context);

  if (
    Math.abs(target.width - rect.shape.width) < SIZE_EPSILON &&
    Math.abs(target.depth - rect.shape.depth) < SIZE_EPSILON
  ) {
    return { status: 'unchanged', pins };
  }

  const candidate = anchoredResize(element, target, pins);
  const conflicts = structureConflicts(element, candidate, context);
  if (conflicts.length === 0)
    return { status: 'ok', element: candidate, clamped: target.clamped, pins };

  return {
    status: 'blocked',
    candidate,
    conflicts,
    alternatives: alternatives(rect, target, pins, context),
    clamped: target.clamped,
    pins,
  };
}

function alternatives(
  element: DesignElement & { shape: { kind: 'rect' } },
  target: { width: number; depth: number },
  pins: StructurePins,
  context: StructureResizeContext,
): StructureAlternative[] {
  const found: StructureAlternative[] = [];
  const fit = largestFit(element, target, pins, context);
  if (fit) found.push(fit);
  found.push(...shifts(element, anchoredResize(element, target, pins), pins, context));
  return found;
}

/**
 * The biggest size on the way from the current one to the requested one that runs into nothing —
 * "use 4.0 m instead of 4.5 m". A binary search, as `largestLegalFactor` does for the assistant.
 * `null` when not even a sliver of the change fits, or when it would be too small a change to offer.
 */
function largestFit(
  element: DesignElement & { shape: { kind: 'rect' } },
  target: { width: number; depth: number },
  pins: StructurePins,
  context: StructureResizeContext,
): StructureAlternative | null {
  const from = { width: element.shape.width, depth: element.shape.depth };
  const at = (t: number) => ({
    width: from.width + (target.width - from.width) * t,
    depth: from.depth + (target.depth - from.depth) * t,
  });
  const clear = (t: number) =>
    structureConflicts(element, anchoredResize(element, at(t), pins), context).length === 0;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) lo = mid;
    else hi = mid;
  }
  // Round down to the centimetre so the label and the geometry say the same number.
  const size = at(lo);
  const rounded = {
    width: roundTowards(size.width, from.width),
    depth: roundTowards(size.depth, from.depth),
  };
  const moved =
    Math.abs(rounded.width - from.width) >= 0.05 || Math.abs(rounded.depth - from.depth) >= 0.05;
  if (!moved) return null;
  const resized = anchoredResize(element, rounded, pins);
  if (structureConflicts(element, resized, context).length) return null;
  return { kind: 'fit', element: resized, size: rounded };
}

/** Round to the centimetre, towards `origin`, so a rounded fit is never bigger than the one tested. */
function roundTowards(value: number, origin: number): number {
  return value >= origin ? Math.floor(value * 100) / 100 : Math.ceil(value * 100) / 100;
}

/**
 * The requested size moved a little along an axis nothing holds it to — "move it 0.4 m away from the
 * house". An axis with a pinned side is not shifted: moving along it would pull the structure off
 * the thing it is against, which is the relationship the resize exists to keep. Up to one per
 * direction, nearest first, at most two.
 */
function shifts(
  element: DesignElement & { shape: { kind: 'rect' } },
  candidate: DesignElement,
  pins: StructurePins,
  context: StructureResizeContext,
): StructureAlternative[] {
  if (candidate.shape.kind !== 'rect') return [];
  const sides = structureSides(candidate.shape);
  const directions: LocalSide[] = [];
  if (!pins.left && !pins.right) directions.push('left', 'right');
  if (!pins.front && !pins.rear) directions.push('front', 'rear');

  const fenceBefore = fenceGaps(candidate, context);
  const found: { distance: number; alternative: StructureAlternative }[] = [];
  for (const side of directions) {
    const outward = sides[side].outward;
    for (let distance = SHIFT_STEP; distance <= SHIFT_LIMIT + 1e-9; distance += SHIFT_STEP) {
      const metres = Math.round(distance * 10) / 10;
      const moved: DesignElement = {
        ...candidate,
        shape: {
          ...candidate.shape,
          centre: {
            x: candidate.shape.centre.x + outward.x * metres,
            y: candidate.shape.centre.y + outward.y * metres,
          },
        },
      };
      if (structureConflicts(element, moved, context).length) continue;
      if (leavesSliver(moved, fenceBefore, context)) continue;
      found.push({
        distance: metres,
        alternative: {
          kind: 'shift',
          element: moved,
          distance: metres,
          direction: shiftDirection(outward, moved, context),
        },
      });
      break;
    }
  }
  return found
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2)
    .map((entry) => entry.alternative);
}

/** How far each side is from the fence, where it is within the clearance. */
function fenceGaps(
  element: DesignElement,
  context: SurroundingsContext,
): Partial<Record<LocalSide, number>> {
  const readings = sideSurroundings(element, context, {
    reach: FENCE_CLEARANCE,
    filter: () => false,
  });
  const gaps: Partial<Record<LocalSide, number>> = {};
  for (const [side, reading] of Object.entries(readings)) {
    if (reading?.neighbour.kind === 'boundary') gaps[side as LocalSide] = reading.gap;
  }
  return gaps;
}

/** Whether a move brings a side newly within the clearance of the fence without touching it. */
function leavesSliver(
  moved: DesignElement,
  before: Partial<Record<LocalSide, number>>,
  context: SurroundingsContext,
): boolean {
  const after = fenceGaps(moved, context);
  return Object.entries(after).some(
    ([side, gap]) => gap !== undefined && gap > 0.05 && before[side as LocalSide] === undefined,
  );
}

function shiftDirection(
  outward: Point,
  moved: DesignElement,
  context: SurroundingsContext,
): 'towards-house' | 'away-from-house' | 'sideways' {
  if (context.house && context.house.length >= 3 && moved.shape.kind === 'rect') {
    const centre = ringCentre(context.house);
    const to = { x: centre.x - moved.shape.centre.x, y: centre.y - moved.shape.centre.y };
    const length = Math.hypot(to.x, to.y);
    if (length > 1e-6) {
      const cos = (outward.x * to.x + outward.y * to.y) / length;
      if (cos > 0.7) return 'towards-house';
      if (cos < -0.7) return 'away-from-house';
    }
  }
  return 'sideways';
}

function ringCentre(ring: Point[]): Point {
  const sum = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / ring.length, y: sum.y / ring.length };
}
