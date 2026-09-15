import {
  DesignRunSchema,
  SYMBOLS,
  boundaryPolygon,
  boundingBox,
  defaultMaterial,
  elementAnchor,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  isLocked,
  pointInPolygon,
  polygonCentroid,
  type DesignElement,
  type DesignRun,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';

/**
 * A redesign, written out by hand, for one purpose: to exercise the whole feature before a model
 * is anywhere near it.
 *
 * Every operation here is the sort of thing the planner will eventually produce, so if this reads
 * well on the canvas the schema, the executor, the overlays and the panel are all right — and if it
 * does not, the fault is in one of those rather than in a model nobody can debug.
 *
 * **Written against predicates, never ids.** A generated concept's ids are `c<seed>-<index>-eN` and
 * change every time concepts are regenerated, so a script naming one would work exactly once. It
 * finds the terrace by asking which paved rectangle sits against the house, and every target it
 * then computes is checked with the same `geometryIsLegal` the store will apply — so the demo
 * cannot script a refusal and call it a design decision. A plan it cannot work with is reported in
 * a sentence rather than half-played.
 */

export type DemoOutcome = { ok: true; run: DesignRun } | { ok: false; reason: string };

/** Enough of a garden to do anything with. */
const MIN_TERRACE_SIDE = 2;

function featureRects(elements: DesignElement[], category: DesignElement['category']): DesignElement[] {
  return elements.filter(
    (element) =>
      element.category === category &&
      element.shape.kind === 'rect' &&
      !element.hidden &&
      !isLocked(element),
  );
}

function area(element: DesignElement): number {
  const box = boundingBox(geometryOutline(element.shape));
  return box.width * box.length;
}

/** The terrace: the biggest paved rectangle, preferring one that is actually against the house. */
function findTerrace(elements: DesignElement[], house: Point[] | null): DesignElement | null {
  const paved = featureRects(elements, 'paved-area')
    .filter((element) => element.shape.kind === 'rect' && Math.min(element.shape.width, element.shape.depth) >= MIN_TERRACE_SIDE)
    .sort((a, b) => area(b) - area(a));
  if (paved.length === 0) return null;

  if (house) {
    const houseCentre = polygonCentroid(house);
    const named = paved.find((element) => /patio|terrace/i.test(element.name ?? ''));
    const nearest = [...paved].sort(
      (a, b) => distance(elementAnchor(a), houseCentre) - distance(elementAnchor(b), houseCentre),
    )[0]!;
    return named ?? nearest;
  }
  return paved[0]!;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The way out of the garden from the house, as one of the four square directions.
 *
 * Square rather than the true bearing because the terrace is an axis-aligned rectangle and what is
 * wanted is which of its four edges must not move. A diagonal answer would grow it in a direction
 * none of its edges face.
 */
function awayFromHouse(terrace: DesignElement, house: Point[] | null): Point {
  if (!house) return { x: 0, y: -1 };
  const delta = {
    x: elementAnchor(terrace).x - polygonCentroid(house).x,
    y: elementAnchor(terrace).y - polygonCentroid(house).y,
  };
  return Math.abs(delta.x) > Math.abs(delta.y)
    ? { x: Math.sign(delta.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(delta.y) || -1 };
}

/** The terrace, grown away from the house with the wall edge pinned — or null if it will not fit. */
function grownTerrace(
  terrace: DesignElement,
  direction: Point,
  boundary: Point[],
): { centre: Point; width: number; depth: number; rotation: number } | null {
  if (terrace.shape.kind !== 'rect') return null;
  const { centre, width, depth, rotation } = terrace.shape;

  /*
   * Only a square-on rectangle is grown from a fixed edge. A rotated one would need the growth
   * resolved into its own axes, and a demo that gets that subtly wrong on somebody's plan is worse
   * than a demo that declines to touch it.
   */
  if (Math.abs(rotation % 90) > 0.01) return null;

  const along = direction.x !== 0 ? 'width' : 'depth';
  const grow = (along === 'width' ? width : depth) * 0.4;

  for (const attempt of [grow, grow * 0.6, grow * 0.3]) {
    const candidate = {
      rotation,
      width: along === 'width' ? width + attempt : width,
      depth: along === 'depth' ? depth + attempt : depth,
      centre: {
        x: centre.x + (direction.x * attempt) / 2,
        y: centre.y + (direction.y * attempt) / 2,
      },
    };
    if (geometryIsLegal({ kind: 'rect', ...candidate }, boundary)) return candidate;
  }
  return null;
}

/** Everything standing on the terrace, which is what has to travel with it. */
function standingOn(terrace: DesignElement, elements: DesignElement[]): DesignElement[] {
  const outline = geometryOutline(terrace.shape);
  return elements.filter(
    (element) =>
      element.id !== terrace.id &&
      !element.hidden &&
      (element.category === 'furniture' || element.category === 'lighting') &&
      pointInPolygon(elementAnchor(element), outline),
  );
}

/**
 * A border deepened, and the open ground beside it giving up exactly what the border takes.
 *
 * Both halves or neither. The lawn panel is drawn *after* the beds, so a bed that grows into it is
 * simply covered up — the change would be real in the document and invisible on the plan, which is
 * the worst of both. Moving the edge they share moves one line in two outlines.
 */
function deepenBorder(
  bed: DesignElement,
  lawn: DesignElement,
  depth: number,
  boundary: Point[],
): { bed: Point[]; lawn: Point[] } | null {
  if (bed.shape.kind !== 'polygon' || lawn.shape.kind !== 'polygon') return null;

  const from = polygonCentroid(bed.shape.points);
  const to = polygonCentroid(lawn.shape.points);
  const axis: 'x' | 'y' = Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? 'x' : 'y';
  const sign = Math.sign(to[axis] - from[axis]) || 1;

  const bedEdge = extreme(bed.shape.points, axis, sign);
  const lawnEdge = extreme(lawn.shape.points, axis, -sign);

  /* Only where the two actually meet. Two shapes a garden apart do not share an edge to move. */
  if (Math.abs(bedEdge - lawnEdge) > 1.5) return null;

  const shift = (points: Point[], edge: number): Point[] =>
    points.map((point) =>
      Math.abs(point[axis] - edge) < 0.35
        ? { ...point, [axis]: point[axis] + sign * depth }
        : point,
    );

  const next = { bed: shift(bed.shape.points, bedEdge), lawn: shift(lawn.shape.points, lawnEdge) };
  const legal =
    geometryIsLegal({ kind: 'polygon', points: next.bed, cornerRadius: 0 }, boundary) &&
    geometryIsLegal({ kind: 'polygon', points: next.lawn, cornerRadius: 0 }, boundary);

  return legal ? next : null;
}

function extreme(points: Point[], axis: 'x' | 'y', sign: number): number {
  return points.reduce(
    (best, point) => (sign > 0 ? Math.max(best, point[axis]) : Math.min(best, point[axis])),
    sign > 0 ? -Infinity : Infinity,
  );
}

/** A point pulled in from a rectangle's corner, where a bollard or a planter can stand. */
function inset(centre: Point, width: number, depth: number, sx: number, sy: number, by: number): Point {
  return { x: centre.x + (sx * (width / 2 - by)), y: centre.y + (sy * (depth / 2 - by)) };
}

export function buildDemoRun(elements: DesignElement[], site: SiteSection): DemoOutcome {
  const boundary = boundaryPolygon(site);
  if (boundary.length < 3) return { ok: false, reason: 'Draw the property boundary first.' };

  const house = site.house ? housePolygon(site.house) : null;
  const terrace = findTerrace(elements, house);
  if (!terrace || terrace.shape.kind !== 'rect')
    return { ok: false, reason: 'This plan has no paved terrace for the designers to work from.' };

  const direction = awayFromHouse(terrace, house);
  const grown = grownTerrace(terrace, direction, boundary);
  if (!grown)
    return { ok: false, reason: 'There is no room to enlarge the terrace on this plan.' };

  const operations: Record<string, unknown>[] = [];
  let counter = 0;
  const next = (over: Record<string, unknown>) => {
    counter += 1;
    operations.push({ id: `op-${counter}`, ...over });
  };

  /* ---- analyse ---- */
  next({
    kind: 'analyse', agent: 'lead', phase: 'analyse',
    label: 'Reading the plan',
    reason: 'Reading the brief against what is already here',
  });

  /* ---- layout: the terrace, and what stands on it ---- */
  next({
    kind: 'select', agent: 'layout', phase: 'layout',
    label: 'Expanding the terrace', reason: 'Making room to entertain',
    elementId: terrace.id,
  });
  next({
    kind: 'resize', agent: 'layout', phase: 'layout',
    label: 'Expanding the terrace', reason: 'Making room to entertain',
    elementId: terrace.id, to: grown,
  });

  const travelling = standingOn(terrace, elements);
  if (travelling.length > 0) {
    const shift = {
      x: (direction.x * (grown.width - terrace.shape.width)) / 2,
      y: (direction.y * (grown.depth - terrace.shape.depth)) / 2,
    };
    const moves = travelling
      .map((element) => {
        const at = elementAnchor(element);
        return { element, to: { x: at.x + shift.x, y: at.y + shift.y } };
      })
      .filter(({ element, to }) =>
        geometryIsLegal(moveTo(element, to), boundary),
      );

    if (moves.length > 0)
      next({
        kind: 'group', agent: 'layout', phase: 'layout', stagger: 70,
        label: 'Moving the furniture', reason: 'Keeping the furniture with the terrace it stands on',
        children: moves.map(({ element, to }, index) => ({
          id: `op-${counter}-${index}`, kind: 'move', agent: 'layout', phase: 'layout',
          label: 'Moving the furniture', elementId: element.id, to,
        })),
      });
  }

  /* ---- layout: something over the dining table ---- */
  const dining = elements.find(
    (element) => element.category === 'furniture' && (element.symbol ?? '').startsWith('dining-set'),
  );
  if (dining) {
    const spec = SYMBOLS.pergola.footprint;
    const at = elementAnchor(dining);
    const pergola = {
      kind: 'rect' as const, centre: at, rotation: 0,
      width: spec.kind === 'rect' ? spec.width : 3.6,
      depth: spec.kind === 'rect' ? spec.depth : 3.6,
    };
    if (geometryIsLegal(pergola, boundary))
      next({
        kind: 'add', agent: 'layout', phase: 'layout',
        label: 'Covering the dining area', reason: 'Somewhere to eat out of the sun',
        ref: '$pergola',
        element: {
          category: 'structure', role: 'feature', name: 'Dining pergola',
          zone: dining.zone, symbol: 'pergola', height: SYMBOLS.pergola.height,
          material: defaultMaterial('structure'), shape: pergola,
        },
      });
  }

  /* ---- circulation: the way to the store ---- */
  const route = elements
    .filter((element) => element.shape.kind === 'polyline' && !element.hidden)
    .sort((a, b) => area(b) - area(a))[0];

  if (route && route.shape.kind === 'polyline') {
    const points = route.shape.points;
    const start = points[0]!;
    const end = points[points.length - 1]!;

    /*
     * A real curve, swept to one side, rather than waypoints along the line it already takes.
     * Interpolating between the two ends produces a "new" route indistinguishable from the old one,
     * which is a demonstration of nothing — the waypoints have to leave the straight line to show
     * that a route was reconsidered.
     */
    const run = { x: end.x - start.x, y: end.y - start.y };
    const length = Math.hypot(run.x, run.y) || 1;
    const across = { x: -run.y / length, y: run.x / length };
    const sweep = Math.min(1.6, length * 0.18);

    const bowedBy = (amount: number) =>
      [0, 0.3, 0.7, 1].map((along, index) => {
        const bend = index === 0 || index === 3 ? 0 : amount * (index === 1 ? 0.8 : 1);
        return {
          x: start.x + run.x * along + across.x * bend,
          y: start.y + run.y * along + across.y * bend,
        };
      });

    /* Either way round the corner, whichever the plot has room for. */
    const width = route.shape.width;
    const bowed =
      [sweep, -sweep, sweep * 0.5, -sweep * 0.5]
        .map(bowedBy)
        .find((candidate) =>
          geometryIsLegal({ kind: 'polyline', points: candidate, width }, boundary),
        ) ?? points;

    if (bowed !== points) {
      next({
        kind: 'select', agent: 'circulation', phase: 'circulation',
        label: 'Improving the route', reason: 'Reconnecting the terrace to the rest of the garden',
        elementId: route.id,
      });
      next({
        kind: 'reroute', agent: 'circulation', phase: 'circulation',
        label: 'Improving the route', reason: 'Reconnecting the terrace to the rest of the garden',
        elementId: route.id, to: { points: bowed },
      });
    }
  }

  /* ---- planting: the border, the shrubs, the lights ---- */
  const beds = elements.filter(
    (element) => element.category === 'planting-bed' && element.shape.kind === 'polygon' && !isLocked(element),
  );
  const lawn = elements.find(
    (element) => element.category === 'lawn' && element.shape.kind === 'polygon' && !isLocked(element),
  );

  if (lawn) {
    for (const bed of beds) {
      const deepened = deepenBorder(bed, lawn, 0.8, boundary);
      if (!deepened) continue;
      next({
        kind: 'group', agent: 'planting', phase: 'planting', stagger: 0,
        label: 'Deepening the border', reason: 'Giving the planting room to read from the house',
        children: [
          { id: `op-${counter}-bed`, kind: 'reshape', agent: 'planting', phase: 'planting',
            label: 'Deepening the border', elementId: bed.id, to: { points: deepened.bed } },
          { id: `op-${counter}-lawn`, kind: 'reshape', agent: 'planting', phase: 'planting',
            label: 'Deepening the border', elementId: lawn.id, to: { points: deepened.lawn } },
        ],
      });
      break;
    }
  }

  const shrubs = elements
    .filter((element) => element.category === 'planting-bed' && element.shape.kind === 'point' && element.bedId)
    .slice(0, 2);
  if (shrubs.length > 0) {
    const moves = shrubs
      .map((element) => {
        const at = elementAnchor(element);
        return { element, to: { x: at.x + direction.x * 0.6, y: at.y + direction.y * 0.6 } };
      })
      .filter(({ element, to }) => geometryIsLegal(moveTo(element, to), boundary));

    if (moves.length > 0)
      next({
        kind: 'group', agent: 'planting', phase: 'planting', stagger: 100,
        label: 'Rebalancing the planting', reason: 'Bringing the structure planting forward',
        children: moves.map(({ element, to }, index) => ({
          id: `op-${counter}-s${index}`, kind: 'move', agent: 'planting', phase: 'planting',
          label: 'Rebalancing the planting', elementId: element.id, to,
        })),
      });
  }

  /* Lighting last, because it is specified from what has actually been placed. */
  const lit = [
    inset(grown.centre, grown.width, grown.depth, -1, -1, 0.4),
    inset(grown.centre, grown.width, grown.depth, 1, -1, 0.4),
    inset(grown.centre, grown.width, grown.depth, 1, 1, 0.4),
    inset(grown.centre, grown.width, grown.depth, -1, 1, 0.4),
  ].filter((at) => geometryIsLegal({ kind: 'point', at, radius: 0.08 }, boundary));

  if (lit.length > 0)
    next({
      kind: 'group', agent: 'planting', phase: 'planting', stagger: 120,
      label: 'Lighting the terrace', reason: 'So the entertaining space works after dark',
      children: lit.map((at, index) => ({
        id: `op-${counter}-l${index}`, kind: 'add', agent: 'planting', phase: 'planting',
        label: 'Lighting the terrace', ref: `$light${index}`,
        element: {
          category: 'lighting', role: 'feature', name: SYMBOLS['light-bollard'].label,
          zone: terrace.zone, symbol: 'light-bollard', height: SYMBOLS['light-bollard'].height,
          material: defaultMaterial('lighting'), shape: { kind: 'point', at, radius: 0.08 },
        },
      })),
    });

  /* ---- review ---- */
  const inspected = [terrace.id, ...(dining ? [dining.id] : []), ...(route ? [route.id] : [])];
  next({
    kind: 'inspect', agent: 'reviewer', phase: 'review',
    label: 'Checking the composition', reason: 'Reading the finished plan back',
    elementIds: inspected.slice(0, 8),
  });

  /*
   * One correction at the end, and a real one: the furniture travelled with the terrace by the
   * distance the terrace grew, which leaves it off-centre on the bigger space. The reviewer
   * centring it is the moment the loop is meant to produce, done here by hand.
   */
  const centrepiece = travelling.find((element) => element.category === 'furniture');
  if (centrepiece && geometryIsLegal(moveTo(centrepiece, grown.centre), boundary)) {
    next({
      kind: 'select', agent: 'reviewer', phase: 'review',
      label: 'Centring the furniture', reason: 'Squaring the seating on the enlarged terrace',
      elementId: centrepiece.id,
    });
    next({
      kind: 'move', agent: 'reviewer', phase: 'review',
      label: 'Centring the furniture', reason: 'Squaring the seating on the enlarged terrace',
      elementId: centrepiece.id, to: grown.centre,
    });
  }

  return {
    ok: true,
    run: DesignRunSchema.parse({
      id: `demo-${elements.length}`,
      request: 'Make the garden better for entertaining, but keep the lawn.',
      operations,
      summary:
        'Terrace enlarged and lit, furniture moved with it, the route re-drawn and the border deepened. The lawn is unchanged.',
    }),
  };
}

/** The element's shape, moved to sit on a new anchor. Mirrors the store's own move. */
function moveTo(element: DesignElement, to: Point) {
  const { shape } = element;
  if (shape.kind === 'point') return { ...shape, at: to };
  if (shape.kind === 'rect') return { ...shape, centre: to };

  const from = elementAnchor(element);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
}
