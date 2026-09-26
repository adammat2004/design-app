import type { Point } from './primitives.js';

/**
 * Arc length along a polyline, and the things that follow from it.
 *
 * A chain is a polyline measured once into cumulative **stations** — the distance from its start to
 * each of its vertices — after which "the point 2.8 m along" and "how far along is this pointer" are
 * both a binary search rather than a walk. It is the machinery an edging run needs (a run is a span
 * of metres along a side), and the machinery a linear course already needed, which is why it lives
 * here rather than in either.
 *
 * It was written inside `apps/web/src/lib/render/linear-course.ts` as `courseMeasure` /
 * `courseSample`; that file now aliases these. The move is what lets the API measure a run — the
 * planner and the schedule both have to, and neither can import the renderer.
 *
 * Metres throughout, like every other length in the model.
 */

/** Below this two consecutive points are the same point, and the second is dropped. */
const EPSILON = 1e-7;

export interface ChainMeasure {
  /** The de-duplicated points. Never the caller's array. */
  points: Point[];
  /** `stations[i]` is the distance from `points[0]` to `points[i]`. */
  stations: number[];
  /** Total length, which is the last station. */
  length: number;
}

/**
 * Measures a polyline.
 *
 * Duplicate consecutive points are dropped rather than kept at zero length: a zero-length segment
 * has no direction, so sampling on it would divide by zero and a tangent would come back as `NaN` —
 * which reaches the drawing as a course laid at no angle at all.
 */
export function measureChain(points: Point[]): ChainMeasure {
  const clean = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > EPSILON,
  );

  const stations = [0];
  for (let i = 1; i < clean.length; i += 1) {
    stations.push(
      stations[i - 1]! + Math.hypot(clean[i]!.x - clean[i - 1]!.x, clean[i]!.y - clean[i - 1]!.y),
    );
  }

  return { points: clean, stations, length: stations.at(-1) ?? 0 };
}

/** The point at a distance along, and the unit direction of travel there. Clamped to both ends. */
export function sampleChain(
  measure: ChainMeasure,
  distance: number,
): { at: Point; tangent: Point } {
  const { points, stations, length } = measure;
  if (points.length < 2) return { at: points[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };

  const target = Math.max(0, Math.min(length, distance));

  let low = 0;
  let high = stations.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (stations[mid]! <= target) low = mid;
    else high = mid;
  }

  const a = points[low]!;
  const b = points[low + 1]!;
  const span = stations[low + 1]! - stations[low]!;
  const tangent = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };

  return {
    at: {
      x: a.x + tangent.x * (target - stations[low]!),
      y: a.y + tangent.y * (target - stations[low]!),
    },
    tangent,
  };
}

/**
 * How far along the chain a point lies, and how far off it.
 *
 * The station is what a drag passes on — **only** that, with the perpendicular offset thrown away —
 * so a pointer dragged out into the garden slides an edging run to the nearest point of the side it
 * belongs to, and there is no frame in which the run is somewhere it could not be. The same
 * guarantee, by the same construction, that `AttachmentHandle` gives a gate.
 */
export function projectOntoChain(
  measure: ChainMeasure,
  point: Point,
): { distance: number; offset: number } {
  const { points, stations } = measure;
  if (points.length < 2) {
    const only = points[0] ?? { x: 0, y: 0 };
    return { distance: 0, offset: Math.hypot(point.x - only.x, point.y - only.y) };
  }

  let best = { distance: 0, offset: Infinity };

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < EPSILON * EPSILON) continue;

    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const at = { x: a.x + t * dx, y: a.y + t * dy };
    const offset = Math.hypot(point.x - at.x, point.y - at.y);

    if (offset < best.offset) {
      best = { distance: stations[i]! + t * Math.sqrt(lengthSquared), offset };
    }
  }

  return best.offset === Infinity ? { distance: 0, offset: Infinity } : best;
}

/**
 * The stretch of the chain between two distances, as its own polyline.
 *
 * Both ends are interpolated and every vertex strictly between them is kept, so a run on a curved
 * bed comes back curved rather than as the straight line between its two ends. Returns fewer than
 * two points for an empty or inverted span, which the caller reads as "this run does not resolve".
 */
export function chainBetween(measure: ChainMeasure, from: number, to: number): Point[] {
  const { points, stations, length } = measure;
  if (points.length < 2) return [];

  const start = Math.max(0, Math.min(length, Math.min(from, to)));
  const end = Math.max(0, Math.min(length, Math.max(from, to)));
  if (end - start <= EPSILON) return [];

  const span: Point[] = [sampleChain(measure, start).at];
  for (let i = 0; i < points.length; i += 1) {
    const station = stations[i]!;
    if (station > start + EPSILON && station < end - EPSILON) span.push(points[i]!);
  }
  span.push(sampleChain(measure, end).at);

  return span;
}
