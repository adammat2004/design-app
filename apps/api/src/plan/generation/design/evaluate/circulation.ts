import {
  distanceToSegment,
  pointInPolygon,
  polygonsIntersect,
  type CirculationStyle,
  type Point,
} from '@garden-studio/schema';
import { MIN_ROUTE_WIDTH, type DesignSubject, type SubjectItem } from './subject.js';
import type { MeasuredIssue, PrincipleResult } from './result.js';

/**
 * Can you get round this garden, and does every path go somewhere?
 *
 * The heaviest principle, and the one the old generator could say least about. Paths were produced
 * by a fixed list on the sketch plus a guarantee that every feature got *a* route; nothing ever
 * asked whether the route was sensible. A path that leaves the terrace, doubles back round the lawn
 * and arrives at the shed from the far side is legal, passes every validator, and is the single
 * clearest sign a plan was assembled rather than designed.
 *
 * Five measurements, each a fraction of the score:
 *
 * - **reach** — every feature that needs access has a route to it, or is close enough to the
 *   terrace to need none.
 * - **directness** — a route's length against the straight line between its ends.
 * - **width** — no primary route narrower than a wheelbarrow.
 * - **clearance** — no route running through a built feature or a planting bed.
 * - **purpose** — no route that ends nowhere.
 */

/**
 * How much longer than the straight line a route may run, by what the concept says it is.
 *
 * Directness used to be rewarded unconditionally, which marked down every plan for doing what its
 * own brief asked: `brief.circulation` is set per concept slot — `perimeter` for a planted reading,
 * `meander` for a naturalistic one — and was read by nothing. A garden you cannot see all of at once
 * is the naturalistic move rather than a route that got lost, and a scorer that calls it a fault is
 * reporting a difference of opinion as a defect.
 *
 * Still bounded, and generously rather than infinitely. Twice round the lawn is a wander whatever
 * the style, which is what keeps this a tolerance rather than an exemption.
 */
const DETOUR: Record<CirculationStyle, { limit: number; bad: number }> = {
  direct: { limit: 1.4, bad: 2.2 },
  axis: { limit: 1.4, bad: 2.2 },
  perimeter: { limit: 1.9, bad: 2.8 },
  meander: { limit: 1.9, bad: 2.8 },
};

/** Within this of the terrace, a feature needs no path of its own: you are already standing on it. */
export const NO_PATH_NEEDED = 2.5;

/** How close two obstacles either side of a route may come before it is a pinch point. */
const PINCH = 0.9;

/** A route whose end is this near a structure arrives at it: the reach `isServed` counts. */
const ARRIVES_WITHIN = 0.6;

/**
 * How wide a route a correction should come back with.
 *
 * Deliberately not `MIN_ROUTE_WIDTH`, which is read off the narrowest route the generator draws on
 * purpose: aiming at it lands exactly on the threshold and the next rounding error puts the fault
 * straight back. A metre is a path two people pass on. It lived in the web review loop until issues
 * could carry what a good answer satisfies; it belongs with the measurement that asks for it.
 */
export const COMFORTABLE_ROUTE = 1;

export function scoreCirculation(subject: DesignSubject): PrincipleResult {
  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  const { routes, items } = subject;

  /* ---- reach: is everything that needs a path served by one? ---- */
  const needsAccess = items.filter((item) => item.feature && item.feature !== 'seating');
  if (needsAccess.length > 0) {
    let served = 0;
    for (const item of needsAccess) {
      if (isServed(item, subject)) {
        served += 1;
        continue;
      }
      issues.push({
        code: 'route-missing',
        principle: 'circulation',
        severity: 'major',
        message: `Nothing connects ${label(item)} to the rest of the garden.`,
        subjects: [item.id],
        repair: 'reroute',
        /* Not a route to redraw but one to lay: what a correction has to do is reach this. */
        guidance: { connect: item.id, minWidthM: COMFORTABLE_ROUTE },
      });
    }
    parts.push(served / needsAccess.length);
  }

  /* ---- directness ---- */
  if (routes.length > 0) {
    const { limit, bad } = DETOUR[subject.brief.circulation];
    let direct = 0;
    for (const route of routes) {
      const ratio = route.span > 0.5 ? route.length / route.span : 1;
      direct += ratio <= limit ? 1 : Math.max(0, 1 - (ratio - limit) / limit);
      if (ratio > bad) {
        issues.push({
          code: 'route-detour',
          principle: 'circulation',
          severity: 'major',
          message: `${route.name} runs ${ratio.toFixed(1)}× the direct line between its ends.`,
          subjects: [route.id],
          repair: 'reroute',
        });
      }
    }
    parts.push(direct / routes.length);

    /* ---- width ---- */
    const narrow = routes.filter((route) => route.width < MIN_ROUTE_WIDTH - 1e-9);
    for (const route of narrow) {
      issues.push({
        code: 'route-too-narrow',
        principle: 'circulation',
        severity: 'minor',
        message: `${route.name} is ${route.width.toFixed(2)} m wide, under the ${MIN_ROUTE_WIDTH} m a wheelbarrow needs.`,
        subjects: [route.id],
        repair: 'widen-path',
        guidance: { minWidthM: COMFORTABLE_ROUTE },
      });
    }
    parts.push(1 - narrow.length / routes.length);

    /* ---- clearance ---- */
    let clear = 0;
    for (const route of routes) {
      const throughFeature = subject.items.find(
        (item) => item.category === 'structure' && polygonsIntersect(route.ring, item.ring),
      );
      /*
       * A path over a lawn or a gravel panel is ordinary and deliberate — that is what stepping
       * stones are. A path *through* a shed is not, and a path through a planting bed means the
       * bed was cut in two by something drawn after it.
       */
      const throughBed = subject.beds.find((bed) => cutsThrough(route, bed.ring));

      if (throughFeature) {
        issues.push({
          code: 'route-through-feature',
          principle: 'circulation',
          severity: 'major',
          message: `${route.name} runs through ${throughFeature.name || 'a structure'}.`,
          subjects: [route.id, throughFeature.id],
          repair: 'reroute',
          guidance: { avoid: [throughFeature.id] },
        });
      } else if (throughBed) {
        issues.push({
          code: 'route-through-planting',
          principle: 'circulation',
          severity: 'minor',
          message: `${route.name} cuts through a planting bed.`,
          subjects: [route.id, throughBed.id],
          repair: 'reroute',
          guidance: { avoid: [throughBed.id] },
        });
      } else {
        clear += 1;
      }
    }
    parts.push(clear / routes.length);

    /* ---- pinch points ---- */
    const pinched = routes
      .map((route) => ({ route, between: pinchAlong(route.centreline, subject) }))
      .filter((entry) => entry.between !== null);
    for (const { route, between } of pinched) {
      issues.push({
        code: 'route-pinch',
        principle: 'circulation',
        severity: 'minor',
        message: `${route.name} squeezes between two things with under ${PINCH} m to spare.`,
        subjects: [route.id],
        repair: 'reroute',
        /* The two it is caught between, which is what a redrawn route has to get clear of. */
        guidance: { avoid: [between!.left, between!.right] },
      });
    }
    parts.push(1 - pinched.length / routes.length);

    /* ---- purpose: a route has to arrive somewhere ---- */
    const pointless = routes.filter((route) => !arrivesSomewhere(route.centreline, subject));
    for (const route of pointless) {
      issues.push({
        code: 'route-dead-end',
        principle: 'circulation',
        severity: 'minor',
        message: `${route.name} ends at nothing in particular.`,
        subjects: [route.id],
        repair: 'reroute',
      });
    }
    parts.push(1 - pointless.length / routes.length);
  }

  /*
   * A garden with no features that need reaching and no paths is not badly circulated — it is a
   * terrace, and there is nothing to score. Neutral rather than perfect: claiming full marks for an
   * empty plan would let a courtyard outscore a well-connected garden on this principle.
   */
  return { score: parts.length > 0 ? mean(parts) : 0.5, issues };
}

/**
 * How far a route's strip may overlap a bed's edge before it is running through the bed.
 *
 * Twice the `SIMPLIFY_TOLERANCE` the fill pass simplifies every bed at. A bed is cut round the paths
 * in PostGIS and then simplified, so where a path runs along a bed — which is exactly what a composed
 * plan's paths do, down the corridor between the lawn and the border — the two share an edge to within
 * five centimetres either way, and a plain intersection test reports every such edge as a path cut
 * through the planting. Measured on the generator: every one of the hits the first composed plans
 * scored was a graze of 0.00 to 0.05 m. The same slack the distance rules carry, for the same reason.
 */
const THROUGH_SLACK = 0.1;

/**
 * Whether a route runs *through* a bed rather than along its edge: its centreline enters the bed, or
 * passes nearer the bed than half its own width less the slack.
 */
function cutsThrough(route: DesignSubject['routes'][number], bed: Point[]): boolean {
  if (!polygonsIntersect(route.ring, bed)) return false;
  const reach = route.width / 2 - THROUGH_SLACK;
  const line = route.centreline;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (pointInPolygon(point, bed)) return true;
      if (reach > 0 && nearestOn(bed, point) < reach) return true;
    }
  }
  return false;
}

/** Whether a feature is reached by a route, or near enough to the house not to need one. */
function isServed(item: SubjectItem, subject: DesignSubject): boolean {
  const door = subject.analysis.exits.primary?.centre ?? subject.analysis.house?.centre ?? null;
  const terrace = subject.items.find((other) => other.feature === 'seating');

  /*
   * Outline to outline. This measured from the terrace's *corners* only, so a water feature a metre
   * off the middle of the terrace's far edge — which you step onto from the paving — was reported as
   * reached by nothing, and the route guarantee, which measured to the edge, rightly laid no path to
   * it. One distance, `ringGap`, read by both.
   */
  if (terrace && ringGap(item.ring, terrace.ring) <= NO_PATH_NEEDED) return true;
  if (door && nearestOn(item.ring, door) <= NO_PATH_NEEDED) return true;

  return subject.routes.some(
    (route) =>
      polygonsIntersect(route.ring, item.ring) ||
      route.centreline.some((point) => nearestOn(item.ring, point) <= 0.6),
  );
}

/** The least distance between two outlines; nought where one reaches into the other. */
export function ringGap(a: Point[], b: Point[]): number {
  let best = Infinity;
  for (const point of a) best = Math.min(best, nearestOn(b, point));
  for (const point of b) best = Math.min(best, nearestOn(a, point));
  return best;
}

function nearestOn(ring: Point[], point: Point): number {
  if (pointInPolygon(point, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, ring[i]!, ring[(i + 1) % ring.length]!));
  }
  return best;
}

/**
 * Whether the route squeezes between two things with under `PINCH` of clear ground.
 *
 * **Both blockers have to be on opposite sides of it**, and that is the whole of the rule. The
 * first version took the two nearest obstacles whatever their direction, which fires on every path
 * laid alongside a bed — the commonest and most deliberate arrangement in a garden, and the reason
 * the harness reported a hundred and sixty pinch points on plans that had none. A route running
 * beside a border is a route beside a border; a route threading between a shed and a border is a
 * gap somebody has to turn sideways for.
 *
 * Measured on the centreline's own vertices rather than by sampling the whole length: a pinch
 * happens at a corner or beside a structure, both of which a vertex lands near, and sampling every
 * ten centimetres of every route across fifty candidates is the kind of cost that makes a scorer
 * too slow to run on all of them.
 */
function pinchAlong(
  centreline: Point[],
  subject: DesignSubject,
): { left: string; right: string } | null {
  /*
   * Not the structure the route arrives at or leaves from. A path ends a hand's breadth off the face
   * of the store it serves, and the store's centre is straight ahead of it — which the side test
   * below files on one side — so every path to a store was reported as squeezing between the store
   * and whatever grew beside its last metre. Arriving at a thing is not being pinched by it.
   */
  const ends = [centreline[0], centreline[centreline.length - 1]].filter(
    (point): point is Point => point !== undefined,
  );
  const blockers = [
    ...subject.items.filter(
      (item) =>
        item.category === 'structure' &&
        !ends.some((end) => nearestOn(item.ring, end) <= ARRIVES_WITHIN),
    ),
    ...subject.beds,
  ];
  if (blockers.length < 2) return null;

  for (let i = 0; i < centreline.length; i += 1) {
    const point = centreline[i]!;
    /* The route's own direction here, so "opposite sides" is a question with an answer. */
    const next = centreline[i + 1] ?? centreline[i - 1];
    if (!next) continue;
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    let left = Infinity;
    let right = Infinity;
    /* The two it is actually squeezing between, so the fault can name what to route round. */
    let leftId: string | null = null;
    let rightId: string | null = null;

    for (const blocker of blockers) {
      const distance = nearestOn(blocker.ring, point);
      if (distance >= PINCH) continue;
      // Cross product sign: which side of the route's direction this blocker's centre lies.
      const side = (dx * (blocker.centre.y - point.y) - dy * (blocker.centre.x - point.x)) / length;
      if (side >= 0) {
        if (distance < right) {
          right = distance;
          rightId = blocker.id;
        }
      } else if (distance < left) {
        left = distance;
        leftId = blocker.id;
      }
    }

    if (left + right < PINCH && leftId && rightId) return { left: leftId, right: rightId };
  }
  return null;
}

/**
 * Whether a route's far end is at something.
 *
 * The house, a gate, a built feature, or an open panel you would walk onto. A route to the middle
 * of a planting bed is not a route, and a route to a corner with nothing in it is the "path that
 * exists because there was spare space" this rule is here to catch.
 */
function arrivesSomewhere(centreline: Point[], subject: DesignSubject): boolean {
  const end = centreline[centreline.length - 1];
  if (!end) return false;

  const gates = subject.analysis.gates.map((gate) => gate.centre);
  const door = subject.analysis.exits.primary?.centre;
  for (const point of [...gates, ...(door ? [door] : [])]) {
    if (Math.hypot(point.x - end.x, point.y - end.y) <= 2) return true;
  }

  const destinations = [
    ...subject.items.map((item) => item.ring),
    ...subject.panels.map((p) => p.ring),
  ];
  return destinations.some((ring) => nearestOn(ring, end) <= 1.2);
}

function label(item: SubjectItem): string {
  return item.name || item.feature || 'a feature';
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
