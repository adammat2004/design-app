import { measureChain, projectOntoChain, chainBetween, type ChainMeasure } from '../../geometry/stations.js';
import { rectToPolygon } from '../../geometry/shapes.js';
import type { Point } from '../../geometry/primitives.js';
import { geometryOutline, type PlanGeometry } from '../features.js';
import { MIN_EDGE_RUN_LENGTH } from '../edges/treatments.js';

/**
 * A surface's boundary, cut into the sides a person would point at.
 *
 * This is the **stable reference** everything about boundary treatments hangs on. A run of edging
 * is "side 2, from 1.4 m to 4.2 m", and that survives the surface being moved, rotated, resized,
 * re-rounded or re-materialised, because none of those changes which side is side 2.
 *
 * ## Why an index, and what breaks it
 *
 * `PlanGeometry` polygons are bare `{x, y}` with no ids, unlike `BoundaryVertex` and `HouseVertex`
 * — so there is nothing to key on but position in the authored list. That is enough for every edit
 * the editor can make *except* one: a `reshape` that changes a polygon's corner count renumbers
 * every side after the change, and a run kept through that would silently re-attach to a side
 * nobody pointed at. `resolveOperation` drops the runs in that one case rather than moving them.
 * Out-of-range sides are ignored on read, never thrown on, so an old document cannot crash a draw.
 *
 * ## The four shapes
 *
 * - **rect** — four sides in `rectToPolygon` order: the top in the rectangle's own frame, then
 *   right, bottom, left. Stable under rotation because the ring is rebuilt from the centre in that
 *   order every time, so side 0 is the same physical side at any angle.
 * - **polygon** — one per authored corner. With a corner radius the drawn ring is seven points per
 *   corner, and a side takes the straight run *plus the half-arc at each of its ends*, so a run on
 *   a curved bed is drawn curved.
 * - **point** (a circular bed) — one closed chain round the perimeter, so a run can cover part of
 *   a circle. There is no "other end" of a closed chain, which is why `anchorFor` pins it to the
 *   start.
 * - **polyline** (a path) — two sides, left and right. `polylineStrip` emits `[...left,
 *   ...right.reverse()]`, so they are slices of the strip; the square end caps are excluded,
 *   because the end of a path is not a side anyone edges.
 */

export interface SideChain {
  /** Index into the authored sides. What `EdgeRun.side` means. */
  side: number;
  /** World metres, in order. At least two points. */
  points: Point[];
  measure: ChainMeasure;
  length: number;
  /** A circular bed's single chain returns to its start; every other chain has two ends. */
  closed: boolean;
}

/** How many sides a person can point at on this shape. Zero is never the answer. */
export function authoredSideCount(shape: PlanGeometry): number {
  switch (shape.kind) {
    case 'rect':
      return 4;
    case 'polygon':
      return shape.points.length;
    case 'point':
      return 1;
    case 'polyline':
      return 2;
  }
}

/**
 * The corners the sides run between, or `null` for a shape whose sides are not corner-to-corner.
 *
 * Exposed because the editor draws its side toggles on *these* rather than on the tessellated ring:
 * a rounded bed's arc points are not corners anybody drew.
 */
export function authoredCorners(shape: PlanGeometry): Point[] | null {
  switch (shape.kind) {
    case 'rect':
      return rectToPolygon(shape);
    case 'polygon':
      return shape.points;
    default:
      return null;
  }
}

export function sideChains(shape: PlanGeometry): SideChain[] {
  const outline = geometryOutline(shape);
  if (outline.length < 2) return [];

  if (shape.kind === 'point') return [chain(0, [...outline, outline[0]!], true)];

  if (shape.kind === 'polyline') {
    const half = outline.length / 2;
    if (!Number.isInteger(half) || half < 2) return [];
    return [chain(0, outline.slice(0, half), false), chain(1, outline.slice(half), false)];
  }

  const corners = authoredCorners(shape);
  if (!corners || corners.length < 3) return [];

  const splits = splitIndices(outline, corners);
  if (!splits) {
    /*
     * The ring could not be cut at its own corners, which a polygon with a zero-length edge and a
     * corner radius can manage — `roundPolygon` emits one point for such a corner rather than
     * seven, so the arcs stop being evenly spaced. Straight chains between the authored corners are
     * the honest degradation: every side still exists and keeps its index, and the only cost is
     * that a run drawn at a rounded corner is drawn straight across it.
     */
    return corners.map((corner, index) =>
      chain(index, [corner, corners[(index + 1) % corners.length]!], false),
    );
  }

  return corners.map((_, index) =>
    chain(index, sliceRing(outline, splits[index]!, splits[(index + 1) % splits.length]!), false),
  );
}

/** One side's chain, or `null` where the shape has no such side. */
export function sideChainAt(shape: PlanGeometry, side: number): SideChain | null {
  if (!Number.isInteger(side) || side < 0) return null;
  return sideChains(shape)[side] ?? null;
}

/* ---------------------------------------------------------------- spans along a side */

/** Where a stored run actually falls on its side today, or `null` if it no longer fits. */
export function spanOfRun(
  chain: SideChain,
  run: { anchor: 'start' | 'end'; from: number; to: number },
): { from: number; to: number } | null {
  const { length } = chain;
  const raw =
    run.anchor === 'start'
      ? { from: run.from, to: run.to }
      : { from: length - run.to, to: length - run.from };

  const from = clamp(Math.min(raw.from, raw.to), length);
  const to = clamp(Math.max(raw.from, raw.to), length);

  /*
   * Refused rather than clamped to a minimum. A run whose side has been typed shorter than it is
   * stops resolving, draws nothing and stays in the document — so it comes back if the geometry
   * does. Silently shortening it would move a thing the user placed; dropping it would lose it.
   */
  return to - from < MIN_EDGE_RUN_LENGTH ? null : { from, to };
}

/**
 * How to store a span so it stays where it was put.
 *
 * **Metres from the nearer end**, which is the rule every other attachment in this model follows: a
 * gate four metres from a corner stays four metres from that corner when the fence is stretched,
 * where a fraction of the side would slide it along. Edging is bought by the metre, so a 2.8 m
 * brick run has to stay 2.8 m when the patio widens — and anchoring it to whichever end it is
 * nearer is what keeps a run at the right of a side at the right of it.
 *
 * A closed chain has no second end to measure from, so it is always anchored to the start.
 */
export function anchorFor(
  chain: SideChain,
  from: number,
  to: number,
): { anchor: 'start' | 'end'; from: number; to: number } {
  const start = clamp(Math.min(from, to), chain.length);
  const end = clamp(Math.max(from, to), chain.length);

  if (chain.closed || (start + end) / 2 <= chain.length / 2) {
    return { anchor: 'start', from: start, to: end };
  }
  return { anchor: 'end', from: chain.length - end, to: chain.length - start };
}

/** The run's own polyline, curves included. Fewer than two points means it does not resolve. */
export function runPolyline(chain: SideChain, from: number, to: number): Point[] {
  return chainBetween(chain.measure, from, to);
}

/** How far along the side a pointer is. The distance off the side is thrown away — see `stations`. */
export function distanceAlongSide(chain: SideChain, point: Point): number {
  return projectOntoChain(chain.measure, point).distance;
}

/** Which side of the shape a point is nearest, with how far off it is. For hit-testing a hover. */
export function nearestSide(
  chains: SideChain[],
  point: Point,
): { side: number; distance: number; offset: number } | null {
  let best: { side: number; distance: number; offset: number } | null = null;

  for (const candidate of chains) {
    const hit = projectOntoChain(candidate.measure, point);
    if (!best || hit.offset < best.offset) {
      best = { side: candidate.side, distance: hit.distance, offset: hit.offset };
    }
  }

  return best;
}

/* ---------------------------------------------------------------- internals */

function chain(side: number, points: Point[], closed: boolean): SideChain {
  const measure = measureChain(points);
  return { side, points: measure.points, measure, length: measure.length, closed };
}

function clamp(value: number, length: number): number {
  return Math.max(0, Math.min(length, value));
}

/**
 * Where each authored corner lands on the tessellated ring.
 *
 * Found by nearest point rather than by index arithmetic over `roundPolygon`'s seven-per-corner
 * output, which is the same answer for every well-formed shape and does not break on the one case
 * that emits a different count. A quadratic Bézier's midpoint is its closest approach to the
 * control point, so on a rounded corner the nearest ring point *is* the middle of that corner's
 * arc — which is exactly where a side should be cut.
 *
 * `null` when the cuts are not distinct and in order round the ring, which is the caller's signal
 * to fall back rather than to emit chains that overlap or run backwards.
 */
function splitIndices(outline: Point[], corners: Point[]): number[] | null {
  if (outline.length < corners.length) return null;

  const splits = corners.map((corner) => nearestIndex(outline, corner));

  if (new Set(splits).size !== splits.length) return null;
  for (let i = 1; i < splits.length; i += 1) {
    if (splits[i]! <= splits[i - 1]!) return null;
  }

  return splits;
}

function nearestIndex(ring: Point[], point: Point): number {
  let best = 0;
  let bestDistance = Infinity;

  for (const [index, candidate] of ring.entries()) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  return best;
}

/** The ring from one index to another inclusive, wrapping. */
function sliceRing(ring: Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let index = from;

  for (let step = 0; step <= ring.length; step += 1) {
    out.push(ring[index]!);
    if (index === to) break;
    index = (index + 1) % ring.length;
  }

  return out;
}
