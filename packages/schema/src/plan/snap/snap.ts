import { rotatePoint, type Point } from '../../geometry/primitives.js';
import type { Unit } from '../units.js';
import {
  ALIGNMENT_THRESHOLD,
  alignmentGuidesFor,
  snapDeltaToTargets,
  type AlignmentGuide,
} from './align.js';
import { snapPoint, snapToStep } from './grid.js';
import type { PlanSnapTargets, SnapPointTarget } from './targets.js';

/**
 * The one snapping engine, for a pointer and for a whole shape.
 *
 * There were five: a grid rounder and an axis-alignment pull in the web's `lib`, a right-angle drawing
 * rule for step 1, and a local `snapped()` in each of the three stores — which is how step 2 came to
 * pull a dragged shape onto a guide while step 5 only drew the guide. Everything here is pure, takes
 * the targets rather than finding them, and reports what it snapped to, so the three editors and the
 * canvases that draw their markers all ask one function.
 *
 * **A snap is a preference, never a permission.** Every caller can pass `accept`, and a candidate it
 * refuses — one that would carry a shape over the fence — is passed over for the next, and finally
 * for the raw position. Snap first, check second, never snap into a refusal.
 */

/**
 * How near counts as near. In screen pixels when the caller knows the zoom, because a fixed distance
 * on the ground is a hair's breadth zoomed out and a yard zoomed in; in metres otherwise, and at the
 * threshold every caller used before this existed when it says nothing.
 */
export interface SnapThreshold {
  px?: number;
  pxPerMetre?: number;
  metres?: number;
}

/** The on-screen reach the editors ask for. */
export const SNAP_REACH_PX = 10;

export function reachOf(threshold: SnapThreshold | undefined): number {
  if (threshold?.px !== undefined && threshold.pxPerMetre !== undefined && threshold.pxPerMetre > 0) {
    return threshold.px / threshold.pxPerMetre;
  }
  return threshold?.metres ?? ALIGNMENT_THRESHOLD;
}

export function closestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x: start.x, y: start.y };
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return { x: start.x + t * dx, y: start.y + t * dy };
}

/* ---------------------------------------------------------------- drawing at right angles */

/**
 * The direction the next side is measured against: the previous side's own direction, or due east
 * for the very first one.
 *
 * Relative to the previous side rather than to the world axes because that is how a site is actually
 * walked — "twelve metres, turn right, eight metres" — and because it keeps snapping useful on a plot
 * that is not square to the screen.
 */
export function drawReference(vertices: Point[]): Point {
  if (vertices.length < 2) return { x: 1, y: 0 };

  const from = vertices[vertices.length - 2]!;
  const to = vertices[vertices.length - 1]!;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1e-9) return { x: 1, y: 0 };

  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/**
 * Where the next corner lands at a right angle to the last side: the pointer projected onto the
 * nearest of the four square directions, with only the *distance* grid-snapped. Snapping the point
 * to the grid afterwards would knock it back off the axis on a plot that is not square to the screen.
 */
export function rightAnglePoint(
  vertices: Point[],
  raw: Point,
  options: { grid: boolean; unit: Unit },
): Point {
  const previous = vertices[vertices.length - 1];
  if (!previous) return options.grid ? snapPoint(raw, options.unit) : raw;

  const reference = drawReference(vertices);
  const dx = raw.x - previous.x;
  const dy = raw.y - previous.y;

  let best = reference;
  let bestReach = -Infinity;
  // Straight on, both right turns, and back the way we came.
  for (const turn of [0, 90, 180, 270]) {
    const direction = rotatePoint(reference, { x: 0, y: 0 }, turn);
    const reach = dx * direction.x + dy * direction.y;
    if (reach > bestReach) {
      bestReach = reach;
      best = direction;
    }
  }

  const distance = options.grid ? snapToStep(Math.max(0, bestReach), options.unit) : bestReach;
  return { x: previous.x + best.x * distance, y: previous.y + best.y * distance };
}

/* ---------------------------------------------------------------- a pointer */

export type SnapSource = 'vertex' | 'midpoint' | 'edge' | 'angle' | 'align' | 'grid' | 'none';

export interface SnapPointOptions {
  /** Off means the raw point, exactly — the switch in the toolbar. */
  enabled: boolean;
  unit: Unit;
  /** Round to the grid where nothing nearer claims the point. On unless said otherwise. */
  grid?: boolean;
  /** Drawing an outline: square to the previous side rather than to the world's axes. */
  rightAngle?: { vertices: Point[] } | null;
  threshold?: SnapThreshold;
  /** Whether a candidate may be used — the caller's legality check. */
  accept?: (point: Point) => boolean;
}

export interface SnapPointResult {
  point: Point;
  source: SnapSource;
  /** Axis lines the result is level with, for the canvas to draw. */
  guides: AlignmentGuide[];
  /** The exact thing snapped to, for a marker: a corner, a midpoint, a point on an edge. */
  marker: Point | null;
}

/**
 * Where a pointer lands. In order of what a designer means when the pointer is near several things:
 * a corner or a midpoint, then an edge, then — drawing — the square turn from the last side, or else
 * a line something is level with, then the grid.
 */
export function snapPointTo(
  raw: Point,
  targets: PlanSnapTargets,
  options: SnapPointOptions,
): SnapPointResult {
  const none: SnapPointResult = { point: raw, source: 'none', guides: [], marker: null };
  if (!options.enabled) return none;

  const reach = reachOf(options.threshold);
  const accept = options.accept ?? (() => true);
  const grid = options.grid ?? true;

  const near = targets.points
    .map((target) => ({ target, distance: Math.hypot(target.at.x - raw.x, target.at.y - raw.y) }))
    .filter((entry) => entry.distance <= reach)
    .sort((a, b) => a.distance - b.distance || kindOrder(a.target) - kindOrder(b.target));
  for (const { target } of near) {
    if (accept(target.at)) {
      return { point: { ...target.at }, source: target.kind, guides: [], marker: { ...target.at } };
    }
  }

  const onEdges = targets.segments
    .map((segment) => closestPointOnSegment(raw, segment.start, segment.end))
    .map((point) => ({ point, distance: Math.hypot(point.x - raw.x, point.y - raw.y) }))
    .filter((entry) => entry.distance <= reach)
    .sort((a, b) => a.distance - b.distance);
  for (const { point } of onEdges) {
    if (accept(point)) return { point, source: 'edge', guides: [], marker: point };
  }

  if (options.rightAngle && options.rightAngle.vertices.length > 0) {
    const squared = rightAnglePoint(options.rightAngle.vertices, raw, { grid, unit: options.unit });
    if (accept(squared)) return { point: squared, source: 'angle', guides: [], marker: null };
  } else {
    const gridded = grid ? snapPoint(raw, options.unit) : raw;
    const guides: AlignmentGuide[] = [];
    const aligned = { ...gridded };
    for (const axis of ['x', 'y'] as const) {
      let best: number | null = null;
      for (const line of targets.lines[axis]) {
        if (Math.abs(line - raw[axis]) > reach) continue;
        if (best === null || Math.abs(line - raw[axis]) < Math.abs(best - raw[axis])) best = line;
      }
      if (best !== null) {
        aligned[axis] = best;
        guides.push({ axis, at: best });
      }
    }
    if (guides.length > 0 && accept(aligned)) {
      return { point: aligned, source: 'align', guides, marker: null };
    }
    if (grid && accept(gridded)) return { point: gridded, source: 'grid', guides: [], marker: null };
  }

  return none;
}

function kindOrder(target: SnapPointTarget): number {
  return target.kind === 'vertex' ? 0 : 1;
}

/* ---------------------------------------------------------------- a whole shape */

export interface ShapeSubject {
  /** The authored corners, which are what lands on a corner or against a wall. */
  corners: Point[];
  /** The drawn outline, whose bounding box is what lines up with the axis lines. */
  outline: Point[];
}

export interface SnapShapeOptions {
  enabled: boolean;
  threshold?: SnapThreshold;
  /** Whether moving the shape by this much is allowed — the caller's legality check. */
  accept?: (delta: Point) => boolean;
}

export interface SnapShapeResult {
  delta: Point;
  guides: AlignmentGuide[];
  marker: Point | null;
}

/**
 * How far to pull a shape being moved so it lands on what it has come close to: one of its corners
 * onto a corner or a midpoint, one of its corners onto an edge — which is what puts a patio flush
 * against a house wall however the house is turned — or its box level with a line.
 *
 * A corner beats an edge and an edge beats an axis line, the nearest winning within each — the same
 * order a pointer is snapped in — and a pull `accept` refuses is passed over for the next.
 */
export function snapShapeDelta(
  subject: ShapeSubject,
  targets: PlanSnapTargets,
  options: SnapShapeOptions,
): SnapShapeResult {
  const zero: SnapShapeResult = { delta: { x: 0, y: 0 }, guides: [], marker: null };
  if (!options.enabled) return zero;

  const reach = reachOf(options.threshold);
  const accept = options.accept ?? (() => true);
  const candidates: { delta: Point; distance: number; rank: number; marker: Point | null }[] = [];

  for (const corner of subject.corners) {
    for (const target of targets.points) {
      const distance = Math.hypot(target.at.x - corner.x, target.at.y - corner.y);
      if (distance > reach) continue;
      candidates.push({
        delta: { x: target.at.x - corner.x, y: target.at.y - corner.y },
        distance,
        rank: 0,
        marker: { ...target.at },
      });
    }
    for (const segment of targets.segments) {
      const on = closestPointOnSegment(corner, segment.start, segment.end);
      const distance = Math.hypot(on.x - corner.x, on.y - corner.y);
      if (distance > reach) continue;
      candidates.push({ delta: { x: on.x - corner.x, y: on.y - corner.y }, distance, rank: 1, marker: on });
    }
  }

  const axis = snapDeltaToTargets(subject.outline, targets.lines, reach);
  if (axis.x !== 0 || axis.y !== 0) {
    candidates.push({ delta: axis, distance: Math.hypot(axis.x, axis.y), rank: 2, marker: null });
  }

  /*
   * Corners first, then edges, then axis lines — and only then the nearest within each. A corner
   * a hair further than the wall it sits on is still the corner the person was aiming for, the way a
   * CAD endpoint wins over the line it ends.
   */
  candidates.sort((a, b) => a.rank - b.rank || a.distance - b.distance);

  const chosen = candidates.find((candidate) => accept(candidate.delta));
  const delta = chosen?.delta ?? { x: 0, y: 0 };
  const moved = subject.outline.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));

  return {
    delta,
    guides: alignmentGuidesFor(moved, targets.lines, reach),
    marker: chosen?.marker ?? null,
  };
}
