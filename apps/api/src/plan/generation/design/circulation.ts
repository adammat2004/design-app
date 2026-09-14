import {
  geometryOutline,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsIntersect,
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
  const {
    start,
    destination,
    via = [],
    obstacles,
    boundary,
    ignore = [],
    scope = null,
    width = PATH_WIDTH,
    skip = 0,
  } = request;

  const aimFrom = via[via.length - 1] ?? start;
  const end = closestPointOnRing(destination, aimFrom, PATH_STANDOFF);

  if (Math.hypot(start.x - end.x, start.y - end.y) < MIN_ROUTE_LENGTH) return null;

  const routes: Point[][] = [];
  if (via.length > 0) routes.push([start, ...via, end]);
  routes.push(
    [start, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: end.x, y: start.y }, end],
  );

  let passed = 0;
  for (const points of routes) {
    const distinct = points.filter(
      (point, i) =>
        i === 0 || Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y) > 0.01,
    );
    const geometry: PlanGeometry = { kind: 'polyline', points: distinct, width };
    const strip = geometryOutline(geometry);
    if (strip.length < 3) continue;
    if (!withinRing(strip, boundary)) continue;
    if (scope && !withinRing(strip, scope)) continue;
    if (
      obstacles.some(
        (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
      )
    ) {
      continue;
    }
    /*
     * Legal. Take it unless the caller asked to see past this many — and note the counter advances
     * only on legal routes, so `skip: 1` means "the second route that would have worked" rather
     * than "the second shape I tried", which is the only reading a repair can act on.
     */
    if (passed < skip) {
      passed += 1;
      continue;
    }
    return geometry;
  }

  return null;
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
