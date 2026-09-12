import type { Point } from '../geometry/primitives.js';
import { geometryOutline } from './features.js';
import { canBeEdged, isEdgingMaterial } from './materials.js';
import type { DesignElement } from './concepts.js';

/**
 * Where a surface is edged, derived from the outline it follows.
 *
 * **Nothing here is stored, and that is the point.** An edging run is a function of a bed's shape,
 * so holding it as its own element would mean two things that can disagree the moment the bed is
 * dragged — and keeping them in step would put a dependency graph inside the editor's move, resize
 * and rotate actions, which is precisely the coupling that rots. `DesignElement.edging` records the
 * *decision* (this bed has a brick course); this file works out where it goes, every read, exactly
 * as `computeZones` derives zones and `openingSegment` derives a door.
 *
 * ## Why this is allowed to look at neighbours, when `CATEGORY_EDGES` was not
 *
 * `CLAUDE.md` records a paving kerb that was tried and reverted, and the reason it failed is
 * specific: it was stroked on each surface's *own clipped raster*, so it could not know a
 * neighbour was there and drew a line down the seam between two abutting patios. Teaching it would
 * have put every surface's neighbours in the raster cache key.
 *
 * This pass has neither constraint. It runs once over the whole element list, before any
 * rasterising, and returns geometry. So it can do the thing the stroke could not: decide which
 * *sides* of a bed are edged, and refuse an edge that two hosts share.
 *
 * ## The two rules
 *
 * - **An edge against the boundary or the house is not edged.** A border runs to the fence, and a
 *   course buried in the fence line is edging nobody can see and nobody would pay for — but which
 *   would appear in the schedule and be ordered. This is the rule the derivation exists for.
 * - **An edge two edged hosts share is one edge.** Two beds meeting along a line have one course
 *   between them, not two. Without this the schedule double-counts every internal seam.
 */

/** One continuous run of edging along one host's outline. */
export interface EdgingRun {
  /** The element this belongs to. Nothing else keys on it; it is for debugging and for the cache. */
  hostId: string;
  /** A `MaterialId` from `EDGING_MATERIALS`. */
  material: string;
  /** World metres, at least two points. A run is open — it is a strip, never a ring. */
  points: Point[];
  /** Metres. Summed by the schedule, which is the only place edging is a quantity. */
  length: number;
}

/**
 * How close a run's edge has to be to the fence or a wall to count as lying on it.
 *
 * 60 mm, and it has to be a real tolerance rather than an exact test: a zone polygon's outer edge
 * *is* the boundary, clipped in floating point, and `computeZones` produces coordinates that miss
 * by fractions of a nanometre. But a bed deliberately held back from the fence by a mowing gap is a
 * different thing and must still be edged, so the tolerance stays far below any gap a designer
 * would draw. This is the same class of problem, and the same answer, as the passage strip not
 * being checked against the house.
 */
export const ON_EDGE_TOLERANCE = 0.06;

/** Below this a segment is a rounding artefact of tessellation, not a length of product. */
const MIN_RUN_LENGTH = 0.15;

/**
 * Every run of edging on the plan.
 *
 * `exclude` is the geometry a run may not lie along — the boundary ring and the house footprint.
 * Both are optional and both default to "no exclusion", because a caller that has neither (a unit
 * test, a thumbnail) should get the honest whole-outline answer rather than a silently different
 * one. The schedule and the renderer both pass them.
 */
export function edgingRuns(
  elements: DesignElement[],
  exclude: { boundary?: Point[]; house?: Point[] } = {},
): EdgingRun[] {
  const walls: Point[][] = [];
  if (exclude.boundary && exclude.boundary.length >= 3) walls.push(exclude.boundary);
  if (exclude.house && exclude.house.length >= 3) walls.push(exclude.house);

  const runs: EdgingRun[] = [];
  /* Segments already claimed by an earlier host, so a shared seam is edged once. */
  const claimed: [Point, Point][] = [];

  for (const element of elements) {
    if (element.hidden) continue;
    if (!canBeEdged(element.category)) continue;
    if (!isEdgingMaterial(element.edging)) continue;

    const outline = geometryOutline(element.shape);
    if (outline.length < 3) continue;

    const segments = segmentsOf(outline);
    const kept = segments.map(
      (segment) =>
        segmentLength(segment) >= MIN_RUN_LENGTH &&
        !walls.some((wall) => segmentLiesOn(segment, wall)) &&
        !claimed.some((other) => segmentsCoincide(segment, other)),
    );

    for (const [index, segment] of segments.entries()) {
      if (kept[index]) claimed.push(segment);
    }

    for (const chain of chainsOf(segments, kept)) {
      runs.push({
        hostId: element.id,
        material: element.edging!,
        points: chain,
        length: chainLength(chain),
      });
    }
  }

  return runs;
}

/**
 * The kept segments joined into continuous runs, which is what a course actually is.
 *
 * **Not cosmetic.** A curved bed is tessellated at two dozen points, so emitting one run per
 * segment does two visibly wrong things: the schedule reports "73 runs" for a garden with six
 * beds, and — worse — `polylineStrip` cuts its caps square, so two dozen one-segment strips leave a
 * notch at every vertex right the way round the curve. One polyline per unbroken chain mitres those
 * joints instead, which is the same reason a path is one polyline rather than a row of them.
 *
 * The wrap is handled rather than ignored: a ring whose first and last segments are both kept is
 * one run passing through the start point, not two meeting there. An unbroken ring comes back as a
 * single closed chain.
 */
function chainsOf(segments: [Point, Point][], kept: boolean[]): Point[][] {
  if (kept.every((keep) => !keep)) return [];

  // An unbroken ring: one closed chain, started anywhere. Every other case starts after a gap.
  if (kept.every((keep) => keep)) {
    return [[...segments.map(([a]) => a), segments[0]![0]]];
  }

  const start = kept.findIndex((keep, index) => keep && !kept[(index - 1 + kept.length) % kept.length]);
  const chains: Point[][] = [];
  let current: Point[] = [];

  for (let step = 0; step < segments.length; step += 1) {
    const index = (start + step) % segments.length;
    if (kept[index]) {
      if (current.length === 0) current.push(segments[index]![0]);
      current.push(segments[index]![1]);
      continue;
    }
    if (current.length >= 2) chains.push(current);
    current = [];
  }

  if (current.length >= 2) chains.push(current);

  return chains;
}

function chainLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/** Total linear metres of one edging material, which is the number the schedule prints. */
export function edgingLength(runs: EdgingRun[], material: string): number {
  return runs.reduce((total, run) => (run.material === material ? total + run.length : total), 0);
}

/** Every edging material in use, so the schedule can group without scanning twice. */
export function edgingMaterialsUsed(runs: EdgingRun[]): string[] {
  return [...new Set(runs.map((run) => run.material))];
}

/* ---------------------------------------------------------------- geometry */

function segmentsOf(ring: Point[]): [Point, Point][] {
  return ring.map((point, index) => [point, ring[(index + 1) % ring.length]!] as [Point, Point]);
}

function segmentLength([a, b]: [Point, Point]): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Whether a segment lies along a ring's own perimeter.
 *
 * Both endpoints *and* the midpoint are tested, which the endpoints alone would not settle: a
 * segment whose two ends happen to touch a concave ring at two different places would pass while
 * running right across the middle of it. Three points is not a proof either, but the shapes here
 * are tessellated outlines rather than adversarial ones, and the cost of a wrong answer is one
 * course of edging drawn or omitted rather than anything the validator cares about.
 */
function segmentLiesOn([a, b]: [Point, Point], ring: Point[]): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [a, mid, b].every((point) => distanceToRing(point, ring) <= ON_EDGE_TOLERANCE);
}

/** Undirected: a seam is the same seam whichever host reached it first. */
function segmentsCoincide(one: [Point, Point], other: [Point, Point]): boolean {
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= ON_EDGE_TOLERANCE;
  return (
    (near(one[0], other[0]) && near(one[1], other[1])) ||
    (near(one[0], other[1]) && near(one[1], other[0]))
  );
}

function distanceToRing(point: Point, ring: Point[]): number {
  let best = Infinity;
  for (const [a, b] of segmentsOf(ring)) {
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
