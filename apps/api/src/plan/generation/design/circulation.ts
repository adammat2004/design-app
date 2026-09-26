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
import type { DesignFrame } from '../layout/frame.js';
import type { RouteTier, SketchPath } from '../layout/sketch.js';
import type { RoutePurpose } from '../room-policy.js';
import { NO_PATH_NEEDED, ringGap } from './evaluate/circulation.js';
import type { LayoutAdjustments } from './types.js';

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
  /**
   * The directions a dog-leg turns along, as unit vectors. Absent is the screen's own axes, which
   * is every caller before routes were laid square to the house: on a plot drawn at an angle a
   * world-axis dog-leg runs diagonally across the garden. The design frame's `axis` and `cross` are
   * what a composed plan passes, so a route that turns, turns square to the terrace it left.
   */
  axes?: { along: Point; across: Point };
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
    axes = { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } },
  } = request;
  /** `origin` moved by the component of `(end − origin)` along `unit`. */
  const turn = (origin: Point, end: Point, unit: Point): Point => {
    const t = (end.x - origin.x) * unit.x + (end.y - origin.y) * unit.y;
    return { x: origin.x + unit.x * t, y: origin.y + unit.y * t };
  };

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
      { shape: 'along-start', points: [origin, turn(origin, end, axes.across), end] },
      { shape: 'along-end', points: [origin, turn(origin, end, axes.along), end] },
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

/* ---------------------------------------------------------------- the one route pass */

/** Something a route can be laid to: a placed room, by the slot it filled. */
export interface RouteTarget {
  id: string;
  ring: Point[];
  name: string;
  /** A store or a working bed: reached with a barrow, so the route is a utility route. */
  utility: boolean;
}

export interface LayRoutesInput {
  paths: SketchPath[];
  /** What each slot was filled with. */
  placed: Map<string, RouteTarget>;
  /** Every placed room that should be reachable, for the guarantee after the sketch's own paths. */
  rooms: RouteTarget[];
  terrace: Point[] | null;
  gate: { centre: Point; inward: Point } | null;
  /**
   * The reserved open space, in world metres, on a composed plan — `null` on a hand-drawn one.
   * A primary or secondary route may not cross it: that is what the corridors were kept for.
   */
  panel: Point[] | null;
  frame: DesignFrame;
  /** Pushed onto as routes are laid, so a later route misses an earlier one. */
  obstacles: Point[][];
  thresholds: Point[][];
  boundary: Point[];
  scope: Point[] | null;
  adjustments: Pick<LayoutAdjustments, 'reroute' | 'routeWidth'>;
  /** How wide a route of this purpose is laid, before any repair widens it. */
  widthOf: (purpose: RoutePurpose) => number;
}

export interface LaidRoute {
  name: string;
  geometry: PlanGeometry;
  purpose: RoutePurpose;
  /** Why the composition laid it, from `design/composition`'s vocabulary. */
  elementPurpose: string;
  /** The room it reaches, where it reaches one. */
  targetId: string | null;
}

/**
 * Every route in the plan, laid once, by the preview and the realisation alike.
 *
 * **There were two copies of this and three sources of routes.** The preview and the realised
 * pipeline each had their own loop over the sketch's paths and their own access guarantee, with a
 * comment in each saying the other must search exactly as hard; the realisation then added a third
 * source, a route from the house to anything the sampler had placed. Two copies that must agree by
 * hand is the defect this codebase keeps writing down, and the third source is where the diagonal
 * lines of stepping stones across the lawn came from — nothing composed them.
 *
 * On a composed plan every route is an edge the composition drew, laid along the corridor it kept,
 * and the lawn is an obstacle to anything but a decorative route: a path to the shed that cannot run
 * down its corridor does not get to cut across the grass instead, it is reported as missing. The
 * guarantee still runs after the composed routes, and on a composed plan it finds nothing to do —
 * which is the measurement that the composition connected everything it placed.
 *
 * Dog-legs turn square to the house, along the design frame's own axes. Pure and query-free.
 */
export function layRoutes(input: LayRoutesInput): LaidRoute[] {
  const { frame, obstacles, adjustments } = input;
  const laid: LaidRoute[] = [];
  const connected = new Set<string>();
  const axes = { along: frame.axis, across: frame.cross };
  const width = (purpose: RoutePurpose) =>
    adjustments.routeWidth === null
      ? input.widthOf(purpose)
      : Math.max(input.widthOf(purpose), adjustments.routeWidth);
  /** The obstacles a route of this tier must miss: the lawn as well, for anything that is not decorative. */
  const blocking = (tier: RouteTier) =>
    input.panel && tier !== 'decorative' ? [...obstacles, input.panel] : obstacles;

  for (const sketched of input.paths) {
    const tier: RouteTier = sketched.tier ?? 'secondary';
    const ignore: Point[][] = [...input.thresholds, ...(input.terrace ? [input.terrace] : [])];
    if (sketched.branch) {
      const trunk = laid.find((route) => route.name === sketched.branch);
      /* A branch off a route that was never laid would start in the middle of a bed. */
      if (!trunk) continue;
      ignore.push(geometryOutline(trunk.geometry));
    }
    let start: Point;
    let destination: Point[];
    let purpose: RoutePurpose;
    let target: RouteTarget | null = null;

    if ('gate' in sketched.to) {
      if (!input.gate || !input.terrace) continue;
      purpose = 'access';
      start = {
        x: input.gate.centre.x + input.gate.inward.x * PATH_STANDOFF,
        y: input.gate.centre.y + input.gate.inward.y * PATH_STANDOFF,
      };
      destination = input.terrace;
    } else {
      target =
        [sketched.to.slot, ...(sketched.to.or ?? [])]
          .map((slot) => input.placed.get(slot))
          .find((found) => found !== undefined) ?? null;
      if (!target) continue;
      purpose = target.utility ? 'utility' : 'secondary';
      destination = target.ring;
      ignore.push(destination);
      start =
        'terrace' in sketched.from
          ? input.terrace
            ? closestPointOnRing(input.terrace, polygonCentroid(destination), 0)
            : frame.toWorld(0, 0)
          : frame.toWorld(sketched.from.u, sketched.from.v);
    }

    const geometry = routeBetween({
      start,
      destination,
      via: (sketched.via ?? []).map((point) => frame.toWorld(point.u, point.v)),
      obstacles: blocking(tier),
      boundary: input.boundary,
      ignore,
      scope: input.scope,
      width: width(purpose),
      skip: adjustments.reroute[sketched.name] ?? 0,
      axes,
    });
    if (!geometry) continue;

    obstacles.push(geometryOutline(geometry));
    laid.push({
      name: sketched.name,
      geometry,
      purpose,
      elementPurpose:
        sketched.purpose ??
        (purpose === 'access'
          ? 'access-route'
          : purpose === 'utility'
            ? 'utility-route'
            : 'garden-route'),
      targetId: target?.id ?? null,
    });
    if (target) connected.add(target.id);
    /* A route that runs past a room's face within reach of it serves it too. */
    for (const room of input.rooms) {
      if (!connected.has(room.id) && passesBy(geometry, room.ring)) connected.add(room.id);
    }
  }

  /*
   * ---- a way to anything the sketch's own routes did not reach ----
   *
   * From several points along the terrace edge, lazily: the nearest succeeds most of the time, and
   * each one that does not costs four polylines tested against every obstacle on the plot. Run
   * eagerly this pass alone once put three and a half seconds on the biggest fixture.
   */
  if (input.terrace) {
    for (const room of input.rooms) {
      if (connected.has(room.id)) continue;
      /*
       * Not to a room a stride from the terrace: you are already standing on it, which is the
       * scorer's own rule. Asked anyway, the nearest start is under the shortest route there is, so
       * the guarantee set off from a corner instead and cut diagonally through the planting to a
       * water feature at the courtyard's edge.
       */
      if (input.terrace && ringGap(room.ring, input.terrace) <= NO_PATH_NEEDED) continue;
      const purpose: RoutePurpose = room.utility ? 'utility' : 'secondary';
      const name = accessName(room.name);
      let geometry: PlanGeometry | null = null;
      for (const start of terraceStarts(input.terrace, room.ring)) {
        geometry = routeBetween({
          start,
          destination: room.ring,
          obstacles: blocking('secondary'),
          boundary: input.boundary,
          ignore: [input.terrace, room.ring, ...input.thresholds],
          scope: input.scope,
          width: width(purpose),
          skip: adjustments.reroute[name] ?? 0,
          axes,
        });
        if (geometry) break;
      }
      if (!geometry) continue;

      obstacles.push(geometryOutline(geometry));
      laid.push({
        name,
        geometry,
        purpose,
        elementPurpose: purpose === 'utility' ? 'utility-route' : 'garden-route',
        targetId: room.id,
      });
      connected.add(room.id);
    }
  }

  return laid;
}

/** How near a route's centreline comes to a room's outline and still serves it, in metres. */
const SERVES_WITHIN = 0.6;

/** Whether any vertex of the route's centreline is within reach of the room: the scorer's own test. */
function passesBy(geometry: PlanGeometry, ring: Point[]): boolean {
  if (geometry.kind !== 'polyline') return false;
  return geometry.points.some((point) => {
    for (let i = 0; i < ring.length; i += 1) {
      if (distanceToSegment(point, ring[i]!, ring[(i + 1) % ring.length]!) <= SERVES_WITHIN)
        return true;
    }
    return false;
  });
}
