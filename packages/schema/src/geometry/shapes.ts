import { edgeLength, polygonArea, polygonIsSimple, rotatePoint, type Point } from './primitives.js';

/**
 * Tessellations. Every shape the app draws is reduced to a plain point ring here, and both the
 * canvas and the PostGIS validator use these rings — so a shape can never render inside the
 * boundary and validate as outside it.
 *
 * That rule is why circles are tessellated in TypeScript rather than buffered in PostGIS: a
 * `ST_Buffer` circle and a hand-rolled octagon are different shapes, and the difference lands
 * as an inexplicable refusal on a tree the editor accepted.
 */

/**
 * Sides in a tessellated circle. Shared by the canvas outline and the validator so the two
 * cannot disagree; 16 reads as a circle at any zoom the plan supports.
 */
export const CIRCLE_SEGMENTS = 16;

/** Straight segments per rounded corner. Enough to read as a curve without bloating the ring. */
export const CORNER_SEGMENTS = 6;

/** Inscribed regular polygon approximating a circle. */
export function circleRing(centre: Point, radius: number, segments = CIRCLE_SEGMENTS): Point[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    };
  });
}

/** A rectangle's corners about its own origin, clockwise from the top-left. */
export function rectangleOutline(width: number, depth: number): Point[] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ];
}

/**
 * Rectangle -> polygon. Exact.
 *
 * Centre-anchored, because every gesture in the editor — the resize handles, the rotation
 * handle, `moveFeature`, `resizeHouse` — is defined about a centre, and rotation is always
 * about the centre anyway. Degrees clockwise, matching Konva and PostGIS's `ST_Rotate` in this
 * y-down frame.
 */
export function rectToPolygon(rect: {
  centre: Point;
  width: number;
  depth: number;
  rotation?: number;
}): Point[] {
  const corners = rectangleOutline(rect.width, rect.depth).map((corner) => ({
    x: corner.x + rect.centre.x,
    y: corner.y + rect.centre.y,
  }));

  const rotation = rect.rotation ?? 0;
  if (rotation === 0) return corners;

  return corners.map((corner) => rotatePoint(corner, rect.centre, rotation));
}

/**
 * Rounds every corner of a polygon by the same amount, returning a plain point ring.
 *
 * Tessellating rather than drawing arcs is deliberate: the rounded ring is what gets rendered,
 * measured, hit-tested and checked against the house and the fence, so there is exactly one
 * shape in play. A patio that draws with soft corners but measures as if it had sharp ones would
 * be the same class of bug as the canvas and the validator disagreeing about a rotated rectangle.
 *
 * The radius is clamped per corner to half the shorter adjoining edge, so a generous radius on a
 * narrow shape rounds as far as it can rather than folding the outline through itself.
 */
export function roundPolygon(
  points: Point[],
  radius: number,
  perCorner: number = CORNER_SEGMENTS,
): Point[] {
  if (radius <= 0 || points.length < 3) return points;

  const rounded: Point[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const previous = points[(i - 1 + points.length) % points.length]!;
    const corner = points[i]!;
    const next = points[(i + 1) % points.length]!;

    const toPrevious = { x: previous.x - corner.x, y: previous.y - corner.y };
    const toNext = { x: next.x - corner.x, y: next.y - corner.y };
    const lengthPrevious = Math.hypot(toPrevious.x, toPrevious.y);
    const lengthNext = Math.hypot(toNext.x, toNext.y);

    if (lengthPrevious === 0 || lengthNext === 0) {
      rounded.push(corner);
      continue;
    }

    const unitPrevious = { x: toPrevious.x / lengthPrevious, y: toPrevious.y / lengthPrevious };
    const unitNext = { x: toNext.x / lengthNext, y: toNext.y / lengthNext };

    // A corner can only eat half of each edge, or neighbouring corners would overlap.
    const cut = Math.min(radius, lengthPrevious / 2, lengthNext / 2);

    const start = { x: corner.x + unitPrevious.x * cut, y: corner.y + unitPrevious.y * cut };
    const end = { x: corner.x + unitNext.x * cut, y: corner.y + unitNext.y * cut };

    // A quadratic Bézier through the corner is visually indistinguishable from a true fillet at
    // these radii and cannot misbehave on a reflex corner the way an arc centre can.
    for (let step = 0; step <= perCorner; step += 1) {
      const t = step / perCorner;
      const inverse = 1 - t;
      rounded.push({
        x: inverse * inverse * start.x + 2 * inverse * t * corner.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * corner.y + t * t * end.y,
      });
    }
  }

  return rounded;
}

/**
 * The same polygon, every edge moved inward by `distance`.
 *
 * Each edge is offset along its inward normal and adjacent offset edges are intersected to find
 * the new corner, which keeps a rectangle a rectangle and an L an L. Drawing only: this is how a
 * wall of real thickness is shown inside the house's outline. The outline itself — the geometry
 * of record — is never replaced by this.
 *
 * `null` rather than a guess when the result would not be a simple polygon: an outline too small
 * for the distance folds through itself, and a wall drawn from that would be a bow tie inside the
 * house. Callers fall back to the flat fill. Works for either winding.
 */
export function insetPolygon(points: Point[], distance: number): Point[] | null {
  if (distance <= 0) return null;
  return offsetPolygon(points, distance);
}

/**
 * The same polygon, every edge moved **outward** by `distance`.
 *
 * The mirror of `insetPolygon` and the same arithmetic with the normal the other way round, which
 * is why they share an implementation rather than having one each — the winding probe, the corner
 * intersections and the fold-through refusal are the subtle parts, and a second copy of them would
 * be a second thing to get wrong.
 *
 * Drawing only, and one caller: a roof oversails its walls. **Nothing derived from this may reach
 * a measurement.** An outset outline is bigger than the thing it came from, so feeding one to
 * `houseFitsInside` would refuse a house that fits.
 *
 * `null` on the same terms as an inset: an outset can still fold through itself at a deep reflex
 * corner, and a roof drawn from that would be a bow tie.
 */
export function outsetPolygon(points: Point[], distance: number): Point[] | null {
  if (distance <= 0) return null;
  return offsetPolygon(points, -distance);
}

/**
 * Every edge moved along its own normal by a signed distance: positive inward, negative outward.
 *
 * Note what makes this work for either sign without a special case — the normal is derived from the
 * ring's own winding, so it always points *inward*, and a negative distance simply walks the other
 * way along it.
 */
function offsetPolygon(points: Point[], distance: number): Point[] | null {
  if (points.length < 3 || distance === 0) return null;

  // Signed area decides which side is inside, so a hand-drawn anticlockwise outline insets too.
  const clockwise = signedArea(points) > 0;
  const sign = clockwise ? 1 : -1;

  const offsetEdges = points.map((start, index) => {
    const end = points[(index + 1) % points.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;

    // Left-hand normal for a clockwise ring in this y-down frame points inward.
    const normal = { x: (-dy / length) * sign, y: (dx / length) * sign };
    return {
      start: { x: start.x + normal.x * distance, y: start.y + normal.y * distance },
      end: { x: end.x + normal.x * distance, y: end.y + normal.y * distance },
    };
  });

  if (offsetEdges.some((edge) => edge === null)) return null;

  const inset: Point[] = [];
  for (let i = 0; i < offsetEdges.length; i += 1) {
    const previous = offsetEdges[(i - 1 + offsetEdges.length) % offsetEdges.length]!;
    const current = offsetEdges[i]!;
    const corner = lineIntersection(previous.start, previous.end, current.start, current.end);
    if (!corner) return null;
    inset.push(corner);
  }

  if (!polygonIsSimple(inset)) return null;

  /*
   * Every inset edge must still run the way its original does. Past the point where opposite
   * walls meet, the offset lines cross and reassemble into a smaller polygon whose edges all run
   * backwards — which the winding and the simplicity checks both miss, because it is a perfectly
   * good polygon, just not this one's inside.
   */
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = inset[i]!;
    const d = inset[(i + 1) % inset.length]!;
    if ((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) <= 0) return null;
  }

  return inset;
}

function signedArea(points: Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** Where two infinite lines meet, or `null` when they are parallel. */
function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-12) return null;

  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/**
 * The ribbon a path or fence covers on the ground.
 *
 * Corners are mitred by averaging the two adjoining normals, and the ends are cut square. That
 * is deliberately *not* what `ST_Buffer` produces — it rounds both — so the strip is tessellated
 * here and handed to PostGIS as a polygon. A buffered line is larger at the ends, which would
 * make the server reject a path the editor laid flush against a fence.
 */
export function polylineStrip(points: Point[], width: number): Point[] {
  if (points.length < 2) return [];

  const half = width / 2;
  const normals: Point[] = points.map((point, index) => {
    const previous = points[index - 1] ?? point;
    const next = points[index + 1] ?? point;

    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return { x: 0, y: 0 };

    // Left-hand normal of the direction of travel.
    return { x: -dy / length, y: dx / length };
  });

  const left = points.map((point, index) => ({
    x: point.x + normals[index]!.x * half,
    y: point.y + normals[index]!.y * half,
  }));
  const right = points
    .map((point, index) => ({
      x: point.x - normals[index]!.x * half,
      y: point.y - normals[index]!.y * half,
    }))
    .reverse();

  return [...left, ...right];
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += edgeLength(points[i - 1]!, points[i]!);
  return total;
}

/** Area of a tessellated ring, for callers that already have one. */
export function ringArea(ring: Point[]): number {
  return polygonArea(ring);
}
