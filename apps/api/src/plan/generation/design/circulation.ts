import {
  distanceToSegment,
  geometryOutline,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsIntersect,
  polylineLength,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';

/**
 * How you get round the garden.
 *
 * Extracted from `concepts.service.ts`, where `routeBetween` was a private method on a Nest service
 * and therefore unreachable by anything that did not have a database connection. It never needed
 * one: a route is four candidate polylines tried in order, each checked against rings the caller
 * already has. Making it a free function is what lets the candidate loop draw circulation for fifty
 * layouts without touching PostGIS.
 *
 * The rules it encodes are worth knowing before changing any of it:
 *
 * - **A route's strip must lie wholly inside the plot.** `polylineStrip` gives square caps, so the
 *   cap round a first leg that runs *along* a boundary sticks through it. That is why a route out
 *   of a gate has to leave perpendicular to its fence, and why a composition that blocks the band
 *   directly inward from a gate produces a gate nobody can walk through.
 * - **Ignored rings are matched by value, not by reference.** `geometryOutline` tessellates afresh
 *   on every call, so the terrace outline a path is told to ignore is never the same array as the
 *   one in `obstacles`. Matched by reference, every path was refused for crossing the terrace it
 *   started on, and no plan the grammar drew had a single path on it.
 * - **A route under `MIN_ROUTE_LENGTH` is refused.** A patio a stride from the house does not get a
 *   path to it; a metre of paving between two things that touch reads as a mistake.
 */

/** How far short of a feature's edge a path stops, so the strip touches rather than enters it. */
export const PATH_STANDOFF = 0.05;

/** The default width of a route, when the caller has no circulation policy to hand. */
export const PATH_WIDTH = 1.2;

/** Under this a path is not a route, it is a step. */
const MIN_ROUTE_LENGTH = 1.5;

export interface RouteRequest {
  start: Point;
  /** The ring the route ends at. It stops `PATH_STANDOFF` short of the nearest point on it. */
  destination: Point[];
  /** Intermediate points, tried first and abandoned if the direct routes do better. */
  via?: Point[];
  obstacles: Point[][];
  boundary: Point[];
  /** Rings the strip may cross: the terrace it starts on, the feature it ends at. */
  ignore?: Point[][];
  /** The drawn redesign area, or `null` when none was drawn. */
  scope?: Point[] | null;
  width?: number;
  /**
   * How many legal routes to pass over before taking one. Zero — the default, and every caller
   * before the repair stage existed — is "the first that works", which is what makes the order
   * below a preference.
   *
   * This is the whole of the `reroute` repair. A path measured as detouring, pinching or running
   * through the planting is usually not an unreachable destination but *this* shape of approach to
   * it, and the next shape down the list is a different one. Skipping rather than reordering keeps
   * the preference intact: a candidate that was never repaired draws exactly what it always drew.
   */
  skip?: number;
}

/**
 * A route from `start` to `destination`, or `null` when none of the four shapes is legal.
 *
 * Straight first, then the two L-shapes, with the caller's `via` route tried ahead of all of them.
 * Deterministic and first-legal rather than best: the order *is* the preference.
 */
export function routeBetween(request: RouteRequest): PlanGeometry | null {
  const { skip = 0 } = request;
  return routeCandidates(request)[skip]?.geometry ?? null;
}

/**
 * A legal route, with what is measurable about it.
 *
 * The metrics are the ones the scorer's circulation principle reads, computed here so a planner can
 * *choose* by them rather than take the first shape that fits. `detour` is length over the straight
 * line; `clearance` is how close the strip comes to the nearest thing it had to miss.
 */
export interface RouteCandidate {
  geometry: PlanGeometry;
  length: number;
  span: number;
  /** Length over the straight line between the ends. One is a straight route. */
  detour: number;
  /** How close the strip passes to the nearest obstacle it is not allowed to touch, in metres. */
  clearance: number;
  /** Which of the four shapes this is, in the order they are preferred. */
  shape: 'via' | 'straight' | 'along-start' | 'along-end';
  /** Which of the caller's `starts` it set off from. */
  startIndex: number;
}

/**
 * Every legal route from the given starts to the destination, in preference order.
 *
 * `routeBetween` is this taking the `skip`-th, and that equivalence is asserted — the order **is**
 * the preference, and a repair that asks for "the second approach that would have worked" is
 * counting entries in this list. Extracted so the assistant's planner can do the thing the repair
 * stage never could: look at all of them and pick the one that answers a stated objective, rather
 * than counting past the ones it does not want.
 *
 * Deterministic and query-free. Four shapes per start, each checked against rings the caller already
 * has, so enumerating thirteen starts costs fifty-two containment tests and no database at all.
 */
export function routeCandidates(request: RouteRequest & { starts?: Point[] }): RouteCandidate[] {
  const {
    start,
    destination,
    via = [],
    obstacles,
    boundary,
    ignore = [],
    scope = null,
    width = PATH_WIDTH,
    starts,
  } = request;

  const from = starts && starts.length > 0 ? starts : [start];
  const found: RouteCandidate[] = [];

  for (const [startIndex, origin] of from.entries()) {
    const aimFrom = via[via.length - 1] ?? origin;
    const end = closestPointOnRing(destination, aimFrom, PATH_STANDOFF);

    if (Math.hypot(origin.x - end.x, origin.y - end.y) < MIN_ROUTE_LENGTH) continue;

    const shapes: { shape: RouteCandidate['shape']; points: Point[] }[] = [];
    if (via.length > 0) shapes.push({ shape: 'via', points: [origin, ...via, end] });
    shapes.push(
      { shape: 'straight', points: [origin, end] },
      { shape: 'along-start', points: [origin, { x: origin.x, y: end.y }, end] },
      { shape: 'along-end', points: [origin, { x: end.x, y: origin.y }, end] },
    );

    for (const { shape, points } of shapes) {
      const distinct = points.filter(
        (point, i) =>
          i === 0 || Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y) > 0.01,
      );
      const geometry: PlanGeometry = { kind: 'polyline', points: distinct, width };
      const strip = geometryOutline(geometry);
      if (strip.length < 3) continue;
      if (!withinRing(strip, boundary)) continue;
      if (scope && !withinRing(strip, scope)) continue;

      const blocking = obstacles.filter((obstacle) => !isIgnored(obstacle, ignore));
      if (blocking.some((obstacle) => polygonsIntersect(strip, obstacle))) continue;

      const length = polylineLength(distinct);
      const span = Math.hypot(origin.x - end.x, origin.y - end.y);
      found.push({
        geometry,
        length,
        span,
        detour: span > 0.5 ? length / span : 1,
        clearance: clearanceOf(strip, blocking),
        shape,
        startIndex,
      });
    }
  }

  return found;
}

/** How close the strip passes to the nearest thing it had to miss; `Infinity` when nothing is near. */
function clearanceOf(strip: Point[], obstacles: Point[][]): number {
  let best = Infinity;
  for (const obstacle of obstacles) {
    for (const point of strip) {
      for (let i = 0; i < obstacle.length; i += 1) {
        best = Math.min(
          best,
          distanceToSegment(point, obstacle[i]!, obstacle[(i + 1) % obstacle.length]!),
        );
      }
    }
  }
  return best;
}

/**
 * A route from the house to a destination.
 *
 * **The point on the house is found in TypeScript, not by `ST_ClosestPoint`.** It used to be a
 * query, which made every path in a plan a round trip and put circulation on the wrong side of the
 * pure/PostGIS line — the candidate loop could not have drawn a route without a database. The
 * answer is the same one `closestPointOnRing` already gave everywhere else; the difference is
 * sub-millimetre and the saving is a query per destination per candidate.
 */
export function routeFromHouse(
  houseRing: Point[],
  destination: Point[],
  rest: Omit<RouteRequest, 'start' | 'destination' | 'ignore'> & { ignore?: Point[][] },
): PlanGeometry | null {
  if (houseRing.length < 3 || destination.length < 3) return null;

  const aim = polygonCentroid(destination);
  return routeBetween({
    start: closestPointOnRing(houseRing, aim, 0),
    destination,
    ...rest,
    /* The house and the thing being reached are both allowed to be touched. */
    ignore: [...(rest.ignore ?? []), houseRing, destination],
  });
}

/**
 * Where on a terrace a path to somewhere else may set off from.
 *
 * The nearest point on the edge first, which is the route a person would take, then quarter points
 * round the rest of it — the answer to a terrace whose obvious corner is blocked by the dining set
 * standing on it, which one start point turns into no path at all.
 *
 * **One copy, and it was two.** The preview and the realised pipeline each had their own, with a
 * comment in each saying the other must search exactly as hard: a preview that tried fewer starts
 * reports a room as unreachable that the built plan then reaches, and the candidate is chosen on a
 * reading its own realisation contradicts. Two functions that must agree by hand are the thing this
 * codebase keeps writing down as a defect.
 */
export function terraceStarts(terrace: Point[], destination: Point[]): Point[] {
  if (terrace.length < 3 || destination.length < 3) return [];

  return [
    closestPointOnRing(terrace, polygonCentroid(destination), 0),
    ...terrace.flatMap((a, i) => {
      const b = terrace[(i + 1) % terrace.length]!;
      return [0.25, 0.5, 0.75].map((t) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }));
    }),
  ];
}

/**
 * What a route to this room is called.
 *
 * Derived from the room rather than counted, because the name is the key the `reroute` repair uses
 * to say *which* path to approach differently — an index would move the moment a repair elsewhere
 * changed how many rooms got placed. Shared for the same reason `terraceStarts` is: the preview and
 * the realisation have to produce the same key or an accepted repair quietly reaches nothing.
 */
export function accessName(room: string): string {
  return `Path to ${room.toLowerCase()}`;
}

/** The point on `ring`'s outline nearest `from`, pulled `standoff` back towards `from`. */
export function closestPointOnRing(ring: Point[], from: Point, standoff: number): Point {
  let best: Point = ring[0]!;
  let bestDistance = Infinity;

  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.y - a.y) * dy) / length2));
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(candidate.x - from.x, candidate.y - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (bestDistance === 0) return best;
  const back = standoff / bestDistance;
  return { x: best.x + (from.x - best.x) * back, y: best.y + (from.y - best.y) * back };
}

/**
 * Contained in `outer` — every vertex inside and no edge crossing out, which is the same predicate
 * the house and the PostGIS validator use. Not re-implemented here.
 */
export function withinRing(inner: Point[], outer: Point[]): boolean {
  if (outer.length < 3) return true;
  return polygonContainsPolygon(outer, inner);
}

/** Rings the strip is allowed to cross, matched by value. See the header for why. */
export function isIgnored(ring: Point[], ignore: Point[][]): boolean {
  return ignore.some((candidate) => sameRing(candidate, ring));
}

export function sameRing(a: Point[], b: Point[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (point, i) => Math.abs(point.x - b[i]!.x) < 1e-9 && Math.abs(point.y - b[i]!.y) < 1e-9,
  );
}
