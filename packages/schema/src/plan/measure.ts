import { edgeLength, pointInPolygon, polygonEdges, type Point } from '../geometry/primitives.js';
import { closestPointOnSegment } from './snap/snap.js';
import { polylineLength } from '../geometry/shapes.js';
import { elementArea, type DesignElement } from './concepts.js';
import { geometryOutline } from './features.js';

/**
 * The lengths a designer reads off an element: how long a path is, how far round a bed its edge
 * runs.
 *
 * Area was the only measurement the editor offered, which is the one that matters for a lawn and
 * says nothing about a path — a 1.2 m path showed "1.2 m wide" and never how long it was, although
 * the length is what it is laid by and what a gravel order is worked out from. Measured off the same
 * outline the validator and the renderer share, so a number here cannot disagree with the shape it
 * describes.
 */
export interface ElementMeasures {
  /** Square metres, as `elementArea` reports it. */
  area: number;
  /**
   * Metres round the outline, for things that have ground to go round — null for a path, whose
   * length is the useful number, and for a tree, a shrub or a light, whose circle is a canopy or a
   * pool of light rather than an edge anybody lays.
   */
  perimeter: number | null;
  /** Metres along the centreline, for a path. Null for everything else. */
  length: number | null;
}

export function elementMeasures(element: DesignElement): ElementMeasures {
  const area = elementArea(element);
  const shape = element.shape;

  if (shape.kind === 'polyline') {
    return { area, perimeter: null, length: polylineLength(shape.points) };
  }

  /* A point is ground only when `elementArea` says it is — a gravel fire pit, not a tree. */
  if (shape.kind === 'point' && area === 0) {
    return { area, perimeter: null, length: null };
  }

  return { area, perimeter: ringPerimeter(geometryOutline(shape)), length: null };
}

/** Metres round a closed ring. */
export function ringPerimeter(ring: { x: number; y: number }[]): number {
  if (ring.length < 2) return 0;
  return polygonEdges(ring).reduce((sum, edge) => sum + edgeLength(edge.start, edge.end), 0);
}

/** The nearest two points between two outlines, and how far apart they are. */
export interface Clearance {
  from: Point;
  to: Point;
  distance: number;
}

function segmentsOf(ring: Point[], closed: boolean): [Point, Point][] {
  const count = closed ? ring.length : ring.length - 1;
  const segments: [Point, Point][] = [];
  for (let index = 0; index < count; index += 1) {
    segments.push([ring[index]!, ring[(index + 1) % ring.length]!]);
  }
  return segments;
}

/**
 * The nearest point pair between two rings: every vertex of each against every edge of the other,
 * which is exact for polygons that do not cross. `from` is on `a`, `to` on `b`.
 */
export function nearestBetween(a: Point[], b: Point[]): Clearance | null {
  if (a.length === 0 || b.length === 0) return null;
  let best: Clearance | null = null;
  const consider = (from: Point, to: Point) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (!best || distance < best.distance) best = { from, to, distance };
  };
  for (const vertex of a) {
    for (const [start, end] of segmentsOf(b, b.length > 2)) consider(vertex, closestPointOnSegment(vertex, start, end));
  }
  for (const vertex of b) {
    for (const [start, end] of segmentsOf(a, a.length > 2)) consider(closestPointOnSegment(vertex, start, end), vertex);
  }
  return best;
}

/**
 * How much room a shape has: to the fence, and to the nearest thing beside it. What a designer reads
 * while dragging — "80 cm off the fence, 1.2 m from the shed" — and what a freeform canvas never says.
 *
 * Only things it is actually clear of count as neighbours: a bed the patio overlaps has no clearance
 * to report, and "0 m to the lawn under it" would be noise on every drag.
 */
export function clearances(
  subject: Point[],
  context: { boundary: Point[]; obstacles: Point[][] },
): { toBoundary: Clearance | null; toNearest: Clearance | null } {
  const toBoundary = context.boundary.length >= 3 ? nearestBetween(subject, context.boundary) : null;
  let toNearest: Clearance | null = null;
  for (const obstacle of context.obstacles) {
    /* One inside the other — a bench on a patio — is standing on it, not clear of it. */
    if (subject[0] && obstacle.length > 2 && pointInPolygon(subject[0], obstacle)) continue;
    if (obstacle[0] && subject.length > 2 && pointInPolygon(obstacle[0], subject)) continue;
    const gap = nearestBetween(subject, obstacle);
    if (!gap || gap.distance < 0.01) continue;
    if (!toNearest || gap.distance < toNearest.distance) toNearest = gap;
  }
  return { toBoundary, toNearest };
}
