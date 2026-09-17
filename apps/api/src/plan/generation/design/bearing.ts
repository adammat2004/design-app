import {
  distanceToSegment,
  normaliseDegrees,
  polygonEdges,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';

/**
 * Which way a thing runs, in degrees clockwise.
 *
 * There was exactly one bearing in this system — `frame.wallBearing`, the garden door's own wall —
 * and it is computed inside the generator's design frame, which the assistant's planner does not
 * have. So "square it to the house" and "line it up with the fence" were questions nothing could
 * answer, and `align` is unperformable in both repair layers because of it.
 *
 * Everything here is pure and takes rings the caller already has. It reads *what is nearest*, which
 * is the honest reading of the request: "square to the house" on an L-shaped building means square
 * to the wall you are standing by, not to whichever wall the outline happens to list first.
 *
 * Degrees clockwise, as every rotation in this codebase is, and folded to a quarter turn where the
 * question is alignment — a rectangle at 90° to a wall is square to it.
 */

/** The bearing of the edge of `ring` nearest `to`, or `null` when there is no ring to read. */
export function nearestEdgeBearing(ring: Point[], to: Point): number | null {
  if (ring.length < 2) return null;

  let best: number | null = null;
  let bestDistance = Infinity;

  for (const edge of polygonEdges(ring)) {
    const distance = distanceToSegment(to, edge.start, edge.end);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = bearingOfSegment(edge.start, edge.end);
  }

  return best;
}

/**
 * The bearing of another element.
 *
 * A rectangle has one already. Anything else is read off its longest edge, which is what "line it up
 * with the border" means about a shape that has no rotation of its own — and returning `null` rather
 * than nought for a shape with no direction, because zero is a bearing and "it has none" is not.
 */
export function bearingOfElement(element: DesignElement): number | null {
  if (element.shape.kind === 'rect') return normaliseDegrees(element.shape.rotation);
  if (element.shape.kind === 'point') return null;

  const { points } = element.shape;
  if (points.length < 2) return null;

  let best: number | null = null;
  let longest = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    /* A polyline does not close, so its last-to-first pair is not an edge of it. */
    if (element.shape.kind === 'polyline' && i === points.length - 1) break;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= longest) continue;
    longest = length;
    best = bearingOfSegment(a, b);
  }

  return best;
}

/**
 * The orientations worth trying to line a rectangle up with a bearing, nearest turn first.
 *
 * Four, because a rectangle square to a wall is square to it whichever way round it sits, and the
 * smallest turn is the one that reads as an adjustment rather than a rearrangement. The caller
 * checks each for legality and takes the first that holds — which is why this returns candidates
 * rather than an answer: whether a terrace can turn at all is a question about what is beside it.
 */
export function squareTo(bearing: number, from: number): number[] {
  return [0, 90, 180, 270]
    .map((quarter) => normaliseDegrees(bearing + quarter))
    .sort((a, b) => turnBetween(from, a) - turnBetween(from, b));
}

/** How far off a rectangle at `rotation` is from `bearing`, allowing for a quarter turn. */
export function offBearing(rotation: number, bearing: number): number {
  const delta = Math.abs(normaliseDegrees(rotation - bearing));
  const folded = delta % 90;
  return Math.min(folded, 90 - folded);
}

/** The shorter way round from one bearing to another, 0 to 180. */
export function turnBetween(from: number, to: number): number {
  const delta = Math.abs(normaliseDegrees(to - from));
  return Math.min(delta, 360 - delta);
}

function bearingOfSegment(a: Point, b: Point): number {
  return normaliseDegrees((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}
