import { z } from 'zod';

/**
 * Garden coordinates are metres in a local planar system: origin at the top-left of the
 * site, +x rightwards, +y downwards (screen-like, so it maps straight onto Konva). Rotations
 * are degrees clockwise, matching Konva's convention.
 *
 * These derivations are shared by the web editor and the API on purpose. If the canvas built
 * a rotated rectangle differently from the validator, a feature could render inside the
 * boundary and then validate as outside it.
 */

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Point = z.infer<typeof PointSchema>;

export const PolygonSchema = z.array(PointSchema).min(3);
export type Polygon = z.infer<typeof PolygonSchema>;

/** Edges in order, so edge `i` runs from vertex `i` to vertex `i + 1`, wrapping at the end. */
export function polygonEdges(polygon: Point[]): { index: number; start: Point; end: Point }[] {
  return polygon.map((start, index) => ({
    index,
    start,
    end: polygon[(index + 1) % polygon.length]!,
  }));
}

export function edgeLength(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function midpoint(start: Point, end: Point): Point {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

export function boundingBox(points: Point[]): {
  minX: number;
  minY: number;
  width: number;
  length: number;
} {
  if (points.length === 0) return { minX: 0, minY: 0, width: 0, length: 0 };

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { minX, minY, width: Math.max(...xs) - minX, length: Math.max(...ys) - minY };
}

/** Shoelace area, always positive — winding direction is not meaningful to the UI. */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceArea) / 2;
}

/**
 * Area-weighted centroid. Falls back to the mean of the vertices for degenerate input — a
 * polygon still being drawn can be a straight line, which has zero area.
 */
export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };

  const mean = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }),
    { x: 0, y: 0 },
  );

  if (points.length < 3) return mean;

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const cross = current.x * next.y - next.x * current.y;

    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) < 1e-9) return mean;

  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/** Rotates `point` about `origin` by `degrees` clockwise, matching the Konva convention. */
export function rotatePoint(point: Point, origin: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

/**
 * Scales `point` away from or towards `origin`. The sibling of `rotatePoint`, and used for the
 * same reason: a whole-plot rescale has to move every coordinate about one fixed centre, or the
 * plot changes shape as well as size.
 */
export function scalePointAbout(point: Point, origin: Point, factor: number): Point {
  return {
    x: origin.x + (point.x - origin.x) * factor,
    y: origin.y + (point.y - origin.y) * factor,
  };
}

/** Unit vector pointing along `degrees` clockwise from +x. */
export function directionFromDegrees(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function normaliseDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Crossing-number ray cast. Points exactly on an edge count as inside. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;

    if (distanceToSegment(point, a, b) < 1e-9) return true;

    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;

    const crossingX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossingX) inside = !inside;
  }

  return inside;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );

  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * True only when the segments properly cross. Touching at an endpoint, or lying along each
 * other, gives a zero determinant and does not count — that is a house wall sitting flush
 * against a fence, which is allowed.
 */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * No two non-adjacent edges cross — a polygon that does not pass through itself.
 *
 * Adjacent edges are skipped because they always meet, at the vertex they share, and
 * `segmentsCross` is already false for a shared endpoint. What this catches is the bow tie: a
 * quadrilateral whose opposite sides cross has a perfectly ordinary vertex list and a shoelace
 * area that is quietly wrong, so nothing downstream would report it.
 */
export function polygonIsSimple(polygon: Point[]): boolean {
  if (polygon.length < 4) return true;

  const edges = polygonEdges(polygon);

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      // Neighbours share a vertex, and the first and last edges are neighbours too.
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;

      const a = edges[i]!;
      const b = edges[j]!;
      if (segmentsCross(a.start, a.end, b.start, b.end)) return false;
    }
  }

  return true;
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Inside the polygon and not on its outline. */
function strictlyInside(point: Point, polygon: Point[]): boolean {
  if (!pointInPolygon(point, polygon)) return false;

  return polygonEdges(polygon).every(
    (edge) => distanceToSegment(point, edge.start, edge.end) > 1e-9,
  );
}

/**
 * Whether two polygons share interior space — the sibling of `polygonContainsPolygon`, built
 * from the same two primitives.
 *
 * A plain edge-crossing test is not enough on its own: one polygon sitting entirely inside
 * another has no crossings at all, and would read as "no overlap". Hence the vertex tests, and
 * the centroids as a backstop for two identical outlines, where every vertex lies on the other's
 * edge. Touching is deliberately not an overlap — the same allowance `segmentsCross` makes for
 * a house wall flush against a fence. This is the TypeScript twin of the API's
 * `ST_Intersects(a, b) AND NOT ST_Touches(a, b)`.
 */
export function polygonsIntersect(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const edgesA = polygonEdges(a);
  const edgesB = polygonEdges(b);

  for (const first of edgesA) {
    for (const second of edgesB) {
      if (segmentsCross(first.start, first.end, second.start, second.end)) return true;
    }
  }

  if (a.some((point) => strictlyInside(point, b))) return true;
  if (b.some((point) => strictlyInside(point, a))) return true;

  return strictlyInside(polygonCentroid(a), b) || strictlyInside(polygonCentroid(b), a);
}

/**
 * Every vertex of `inner` inside `outer`, and no edges crossing. The crossing test is what
 * catches a shape spanning a concave notch in the plot — its corners can all sit inside while
 * the middle of an edge pokes out through the boundary.
 */
export function polygonContainsPolygon(outer: Point[], inner: Point[]): boolean {
  if (outer.length < 3 || inner.length < 3) return false;
  if (!inner.every((point) => pointInPolygon(point, outer))) return false;

  for (let i = 0; i < inner.length; i += 1) {
    const a1 = inner[i]!;
    const a2 = inner[(i + 1) % inner.length]!;

    for (let j = 0; j < outer.length; j += 1) {
      const b1 = outer[j]!;
      const b2 = outer[(j + 1) % outer.length]!;
      if (segmentsCross(a1, a2, b1, b2)) return false;
    }
  }

  return true;
}

/**
 * Sutherland-Hodgman clip of `subject` against a single half-plane, keeping everything on the
 * side the `normal` points towards. Half-planes are convex, so a chain of these is all the
 * zone splitter needs — no boolean-geometry library.
 */
export function clipToHalfPlane(subject: Point[], origin: Point, normal: Point): Point[] {
  if (subject.length < 3) return [];

  const side = (point: Point) => (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;

  const output: Point[] = [];

  for (let i = 0; i < subject.length; i += 1) {
    const current = subject[i]!;
    const previous = subject[(i - 1 + subject.length) % subject.length]!;
    const currentInside = side(current) >= 0;
    const previousInside = side(previous) >= 0;

    if (currentInside !== previousInside) {
      const t = side(previous) / (side(previous) - side(current));
      output.push({
        x: previous.x + t * (current.x - previous.x),
        y: previous.y + t * (current.y - previous.y),
      });
    }

    if (currentInside) output.push(current);
  }

  return output;
}
