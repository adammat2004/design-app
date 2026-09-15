import type { PlanGeometry, Point } from '@garden-studio/schema';
import { easeInOutCubic, lerp, lerpPoint } from './easing';

/**
 * Shoelace area keeping its sign, which is the one thing `polygonArea` deliberately throws away.
 *
 * That function is documented as always positive because winding "is not meaningful to the UI" —
 * true everywhere it is used, and false here: which way round a ring is listed is the difference
 * between a bed morphing into its new outline and a bed turning inside out on the way. Written
 * locally rather than changing the shared one, for the reason `openingNormal` probes for its
 * direction instead of assuming one.
 */
function signedArea(points: Point[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twice += current.x * next.y - next.x * current.y;
  }
  return twice / 2;
}

/**
 * A shape part-way between two shapes.
 *
 * Every function here returns **valid `PlanGeometry`**, not a drawing instruction. That is the rule
 * the whole feature rests on: an in-between frame is a real rectangle or a real ring, so if one
 * ever did reach the store nothing downstream would have to cope with a half-shape. What keeps them
 * out of the store is separate (the executor only commits at operation boundaries) — this is the
 * belt as well as the braces.
 *
 * `p = 1` returns the target **by identity**, so the value that lands on the plan is the exact one
 * the operation asked for and never a re-derived approximation of it. Vertex matching and ring
 * alignment exist only to make the morph readable; they must never decide what gets stored.
 */

/** Degrees, taking the short way round: 350 → 10 crosses zero rather than winding back through 180. */
export function shortestArc(from: number, to: number, p: number): number {
  const delta = (((to - from) % 360) + 540) % 360 - 180;
  return from + delta * p;
}

/**
 * Two rings of the same length, matched up so the morph does not turn itself inside out.
 *
 * Two things can go wrong when interpolating one outline into another, and both look like the
 * geometry exploding rather than like a bug:
 *
 *   - **Opposite winding.** A ring drawn clockwise lerped onto an anticlockwise one has every
 *     vertex travelling to the far side of the shape, so the bed folds through itself half way.
 *   - **A different starting corner.** The same rectangle listed from a different corner sends each
 *     vertex to its neighbour's place, and the shape spins as it morphs.
 *
 * Fixed by matching the winding first, then choosing the rotation of the target that moves the
 * vertices least. Both are decisions about *presentation*; the stored result is untouched.
 */
export function alignRings(from: Point[], to: Point[]): Point[] {
  if (from.length !== to.length) return to;

  const matched = signedArea(from) * signedArea(to) < 0 ? [...to].reverse() : to;

  let best = matched;
  let least = Infinity;
  for (let offset = 0; offset < matched.length; offset += 1) {
    let cost = 0;
    for (let index = 0; index < from.length; index += 1) {
      const candidate = matched[(index + offset) % matched.length]!;
      const anchor = from[index]!;
      cost += (candidate.x - anchor.x) ** 2 + (candidate.y - anchor.y) ** 2;
    }
    if (cost < least) {
      least = cost;
      best = matched.slice(offset).concat(matched.slice(0, offset));
    }
  }
  return best;
}

/**
 * The shorter ring, given extra vertices until it is as long as the other — without changing shape.
 *
 * Splitting the longest edge at its midpoint adds a vertex that is already on the outline, so the
 * ring it returns encloses exactly the same ground. Arc-length resampling was the obvious
 * alternative and is worse here: the beds in this app are rectilinear, and resampling a rectangle
 * to twelve evenly spaced points makes its corners drift into curves the moment the morph starts.
 */
export function matchVertexCount(ring: Point[], count: number): Point[] {
  if (ring.length >= count) return ring;

  const points = [...ring];
  while (points.length < count) {
    let longest = 0;
    let span = -1;
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!;
      const end = points[(index + 1) % points.length]!;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > span) {
        span = length;
        longest = index;
      }
    }
    const start = points[longest]!;
    const end = points[(longest + 1) % points.length]!;
    points.splice(longest + 1, 0, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  }
  return points;
}

/** The first `distance` metres of a route, as a route. Never fewer than two points. */
export function prefixAlongLength(points: Point[], distance: number): Point[] {
  if (points.length < 2) return points;

  const head = points[0]!;
  if (distance <= 0) return [head, head];

  const out: Point[] = [head];
  let travelled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const span = Math.hypot(to.x - from.x, to.y - from.y);

    if (travelled + span >= distance) {
      const along = span === 0 ? 0 : (distance - travelled) / span;
      out.push(lerpPoint(from, to, along));
      return out;
    }

    out.push(to);
    travelled += span;
  }
  return out;
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/**
 * The shape at progress `p`, already eased by the caller.
 *
 * Kinds that do not match are not blended — the target is returned. Nothing should ever ask for
 * that, because `resolveOperation` refuses an operation whose target is a different kind from its
 * subject; this is what happens if something does, and jumping is a better answer than inventing a
 * halfway house between a rectangle and a route.
 */
export function interpolateGeometry(from: PlanGeometry, to: PlanGeometry, p: number): PlanGeometry {
  if (p >= 1) return to;
  if (p <= 0) return from;
  if (from.kind !== to.kind) return to;

  switch (to.kind) {
    case 'point': {
      const start = from as Extract<PlanGeometry, { kind: 'point' }>;
      return { ...to, at: lerpPoint(start.at, to.at, p), radius: lerp(start.radius, to.radius, p) };
    }
    case 'rect': {
      const start = from as Extract<PlanGeometry, { kind: 'rect' }>;
      return {
        ...to,
        centre: lerpPoint(start.centre, to.centre, p),
        width: lerp(start.width, to.width, p),
        depth: lerp(start.depth, to.depth, p),
        rotation: shortestArc(start.rotation, to.rotation, p),
      };
    }
    case 'polygon': {
      const start = from as Extract<PlanGeometry, { kind: 'polygon' }>;
      const count = Math.max(start.points.length, to.points.length);
      const a = matchVertexCount(start.points, count);
      const b = alignRings(a, matchVertexCount(to.points, count));
      return {
        ...to,
        points: a.map((point, index) => lerpPoint(point, b[index] ?? point, p)),
        cornerRadius: lerp(start.cornerRadius, to.cornerRadius, p),
      };
    }
    case 'polyline': {
      const start = from as Extract<PlanGeometry, { kind: 'polyline' }>;
      const count = Math.max(start.points.length, to.points.length);
      const a = resampleRoute(start.points, count);
      const b = resampleRoute(to.points, count);
      return {
        ...to,
        points: a.map((point, index) => lerpPoint(point, b[index] ?? point, p)),
        width: lerp(start.width, to.width, p),
      };
    }
  }
}

/**
 * A route re-pointed at `count` evenly spaced stations along itself.
 *
 * Unlike a bed, a route genuinely *is* a line with a length, so even spacing is the honest reading
 * and there are no corners to round off. This is only used where one route morphs into another,
 * which the executor reserves for the rare reroute that is not worth the three-phase draw.
 */
export function resampleRoute(points: Point[], count: number): Point[] {
  if (points.length >= count && points.length === count) return points;

  const total = polylineLength(points);
  if (total === 0) return Array.from({ length: count }, () => points[0]!);

  return Array.from({ length: count }, (_unused, index) => {
    const along = prefixAlongLength(points, (total * index) / (count - 1));
    return along[along.length - 1]!;
  });
}

/** The eased shape for a transform, which is the one curve every geometry change uses. */
export function transformGeometry(from: PlanGeometry, to: PlanGeometry, p: number): PlanGeometry {
  return interpolateGeometry(from, to, easeInOutCubic(p));
}
