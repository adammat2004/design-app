import {
  distanceToSegment,
  pointInPolygon,
  polygonsIntersect,
  type DesignIssue,
  type Point,
} from '@garden-studio/schema';
import { MIN_ROUTE_WIDTH, type DesignSubject, type SubjectItem } from './subject.js';
import type { PrincipleResult } from './result.js';

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

/** A route may be this much longer than the straight line before it reads as a detour. */
const DETOUR_LIMIT = 1.4;

/** Beyond this it is not a route with character, it is a route that got lost. */
const DETOUR_BAD = 2.2;

/** Within this of the terrace, a feature needs no path of its own: you are already standing on it. */
const NO_PATH_NEEDED = 2.5;

/** How close two obstacles either side of a route may come before it is a pinch point. */
const PINCH = 0.9;

export function scoreCirculation(subject: DesignSubject): PrincipleResult {
  const issues: DesignIssue[] = [];
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
      });
    }
    parts.push(served / needsAccess.length);
  }

  /* ---- directness ---- */
  if (routes.length > 0) {
    let direct = 0;
    for (const route of routes) {
      const ratio = route.span > 0.5 ? route.length / route.span : 1;
      direct += ratio <= DETOUR_LIMIT ? 1 : Math.max(0, 1 - (ratio - DETOUR_LIMIT) / DETOUR_LIMIT);
      if (ratio > DETOUR_BAD) {
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
      const throughBed = subject.beds.find((bed) => polygonsIntersect(route.ring, bed.ring));

      if (throughFeature) {
        issues.push({
          code: 'route-through-feature',
          principle: 'circulation',
          severity: 'major',
          message: `${route.name} runs through ${throughFeature.name || 'a structure'}.`,
          subjects: [route.id, throughFeature.id],
          repair: 'reroute',
        });
      } else if (throughBed) {
        issues.push({
          code: 'route-through-planting',
          principle: 'circulation',
          severity: 'minor',
          message: `${route.name} cuts through a planting bed.`,
          subjects: [route.id, throughBed.id],
          repair: 'reroute',
        });
      } else {
        clear += 1;
      }
    }
    parts.push(clear / routes.length);

    /* ---- pinch points ---- */
    const pinched = routes.filter((route) => pinchAlong(route.centreline, subject));
    for (const route of pinched) {
      issues.push({
        code: 'route-pinch',
        principle: 'circulation',
        severity: 'minor',
        message: `${route.name} squeezes between two things with under ${PINCH} m to spare.`,
        subjects: [route.id],
        repair: 'reroute',
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

/** Whether a feature is reached by a route, or near enough to the house not to need one. */
function isServed(item: SubjectItem, subject: DesignSubject): boolean {
  const door = subject.analysis.exits.primary?.centre ?? subject.analysis.house?.centre ?? null;
  const terrace = subject.items.find((other) => other.feature === 'seating');

  for (const anchor of [terrace?.ring, door ? [door] : null]) {
    if (!anchor) continue;
    for (const point of anchor) {
      if (nearestOn(item.ring, point) <= NO_PATH_NEEDED) return true;
    }
  }

  return subject.routes.some(
    (route) =>
      polygonsIntersect(route.ring, item.ring) ||
      route.centreline.some((point) => nearestOn(item.ring, point) <= 0.6),
  );
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
function pinchAlong(centreline: Point[], subject: DesignSubject): boolean {
  const blockers = [
    ...subject.items.filter((item) => item.category === 'structure'),
    ...subject.beds,
  ];
  if (blockers.length < 2) return false;

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
    for (const blocker of blockers) {
      const distance = nearestOn(blocker.ring, point);
      if (distance >= PINCH) continue;
      // Cross product sign: which side of the route's direction this blocker's centre lies.
      const side = (dx * (blocker.centre.y - point.y) - dy * (blocker.centre.x - point.x)) / length;
      if (side >= 0) right = Math.min(right, distance);
      else left = Math.min(left, distance);
    }

    if (left + right < PINCH) return true;
  }
  return false;
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
