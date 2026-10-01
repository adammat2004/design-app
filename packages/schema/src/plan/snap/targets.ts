import { midpoint, type Point } from '../../geometry/primitives.js';
import { rectToPolygon } from '../../geometry/shapes.js';
import { isGroundLayer, type DesignElement } from '../concepts.js';
import { geometryOutline, type PlanGeometry } from '../features.js';
import { boxSnapLines, collectSnapTargets, cornerSnapLines, type SnapTargets } from './align.js';

/**
 * Everything on a plan a pointer or a shape can snap to, gathered once.
 *
 * Three kinds, because a garden is designed against three kinds of thing. **Points** — a corner of
 * the house, the middle of a fence — are where a new corner wants to land exactly. **Segments** — a
 * house wall, the edge of the patio — are what a shape wants to sit flush against, at whatever angle
 * the wall runs. **Lines** are the old axis alignments, "level with that", which are what a shape
 * lines up with when nothing touches it.
 *
 * Built from the authored corners rather than the drawn outline: a rounded bed tessellates each
 * corner into seven points, and snapping to the fourth of them is snapping to an artefact of the
 * renderer. The axis lines keep reading the drawn outline, which is what they always read.
 */

export interface SnapPointTarget {
  at: Point;
  kind: 'vertex' | 'midpoint';
}

export interface SnapSegment {
  start: Point;
  end: Point;
}

export interface PlanSnapTargets {
  points: SnapPointTarget[];
  segments: SnapSegment[];
  lines: SnapTargets;
}

export const NO_SNAP_TARGETS: PlanSnapTargets = { points: [], segments: [], lines: { x: [], y: [] } };

/** A shape's authored corners, and whether they close into a ring. */
export function cornersOf(shape: PlanGeometry): { points: Point[]; closed: boolean } {
  switch (shape.kind) {
    case 'rect':
      return { points: rectToPolygon(shape), closed: true };
    case 'polygon':
      return { points: shape.points, closed: true };
    case 'polyline':
      return { points: shape.points, closed: false };
    case 'point':
      return { points: [shape.at], closed: false };
  }
}

function addRing(targets: PlanSnapTargets, points: Point[], closed: boolean): void {
  const edges = closed ? points.length : points.length - 1;
  for (const at of points) targets.points.push({ at, kind: 'vertex' });
  for (let index = 0; index < edges; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    if (start.x === end.x && start.y === end.y) continue;
    targets.segments.push({ start, end });
    targets.points.push({ at: midpoint(start, end), kind: 'midpoint' });
  }
}

export interface SnapTargetSources {
  /** The plot's corners, in order. */
  boundary: Point[];
  /** The house footprint, if there is one. */
  house?: Point[] | null;
  /** The elements to snap to — the caller leaves out what is moving and what is not shown. */
  elements?: DesignElement[];
}

export function snapTargetsFor({ boundary, house, elements = [] }: SnapTargetSources): PlanSnapTargets {
  const targets: PlanSnapTargets = { points: [], segments: [], lines: { x: [], y: [] } };
  const lineSources: SnapTargets[] = [];

  if (boundary.length >= 3) {
    addRing(targets, boundary, true);
    lineSources.push(cornerSnapLines(boundary));
  }

  if (house && house.length >= 3) {
    addRing(targets, house, true);
    lineSources.push(boxSnapLines(house));
  }

  for (const element of elements) {
    /*
     * A base fill is a whole zone, and a zone's edges include the seams `computeZones` cuts across
     * the middle of the garden — lines nobody built. Pulling a patio onto one would feel like the
     * plan was sticky for no reason, so a base fill offers its axis lines (as it always did) and no
     * corners or edges.
     */
    if (!isGroundLayer(element)) {
      const { points, closed } = cornersOf(element.shape);
      addRing(targets, points, closed);
    }
    lineSources.push(boxSnapLines(geometryOutline(element.shape)));
  }

  targets.lines = collectSnapTargets(lineSources);
  return targets;
}
