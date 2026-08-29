import { polygonEdges, rotatePoint, type BoundaryVertex, type Point } from '@garden-studio/schema';
import { snapPoint, snapToStep } from './grid';
import type { Unit } from './units';

/**
 * Step 1's editor state, and the few geometry helpers only the editor needs.
 *
 * The primitives themselves — areas, centroids, containment, half-plane clipping — live in
 * `@garden-studio/schema` and are re-exported here, so the screens keep importing from one
 * place while the API gets the same arithmetic. What stays local is editor behaviour: the
 * draft the undo stack rewinds, the vertex labels, and edge reflow.
 *
 * Coordinates are metres, origin top-left, +x right, +y down, so they map straight onto Konva.
 * Rotations are degrees clockwise.
 */

export {
  boundingBox,
  clipToHalfPlane,
  directionFromDegrees,
  distanceToSegment,
  edgeLength,
  midpoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonContainsPolygon,
  polygonEdges,
  polygonIsSimple,
  polygonsIntersect,
  rotatePoint,
  scalePointAbout,
  segmentsCross,
  type BoundaryVertex,
} from '@garden-studio/schema';

export type { SiteSection as BoundaryDraft } from '@garden-studio/schema';

export interface BoundaryEdge {
  index: number;
  start: Point;
  end: Point;
}

/** The boundary polygon, stripped of the vertex ids the editor carries around. */
export function draftPolygon(draft: { vertices: BoundaryVertex[] }): Point[] {
  return draft.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
}

/** Spreadsheet-style labels so a garden with more than 26 corners still reads sensibly. */
export function vertexLabel(index: number): string {
  let label = '';
  let n = index;

  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }

  return label;
}

/**
 * Edges in order, edge `i` running vertex `i` -> `i + 1`. Closed polygons wrap, so
 * `polygonEdges` from the shared package already does the job; an open polygon mid-draw has
 * no closing edge and needs the wrap dropped.
 */
export function boundaryEdges(points: Point[], closed: boolean): BoundaryEdge[] {
  if (points.length < 2) return [];
  if (closed) return polygonEdges(points);

  return points.slice(0, -1).map((start, index) => ({ index, start, end: points[index + 1]! }));
}

/**
 * Where a ray first meets a polygon's outline, or null if it never does. This is how a
 * dimension guide finds the fence: walk out from a house wall along its normal and stop at
 * the boundary. Comparing edge coordinates instead would only work for an axis-aligned house
 * on a rectangular plot.
 */
export function rayPolygonIntersection(
  origin: Point,
  direction: Point,
  polygon: Point[],
): Point | null {
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1e-9 || polygon.length < 2) return null;

  const dx = direction.x / length;
  const dy = direction.y / length;

  let nearest: number | null = null;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;

    // Ray and edge are parallel, so either no crossing or an overlap we do not want.
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-12) continue;

    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denominator;
    const u = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denominator;

    if (t < 1e-9 || u < 0 || u > 1) continue;
    if (nearest === null || t < nearest) nearest = t;
  }

  return nearest === null ? null : { x: origin.x + dx * nearest, y: origin.y + dy * nearest };
}

/**
 * Sets one edge's length by sliding a single vertex along the edge's existing direction and
 * leaving every other vertex where it is. This is deliberately not a constraint solver: the
 * two edges meeting at the moved vertex change length as a side effect, which is what a
 * "recompute just that edge's endpoint" rule implies.
 *
 * The closing edge is the exception. Its end vertex is vertex A, so moving it would drag the
 * whole shape's anchor and silently change edge A->B as well; there we move the start vertex
 * instead.
 */
/**
 * The direction the next side is measured against: the previous side's own direction, or due
 * east for the very first one.
 *
 * Relative to the previous side rather than to the world axes because that is how a site is
 * actually walked — "twelve metres, turn right, eight metres" — and because it keeps snapping
 * useful on a plot that is not square to the screen. A plot drawn at 20° off axis still has right
 * angles, and world-axis snapping would fight every one of them.
 */
export function drawReference(vertices: Point[]): Point {
  if (vertices.length < 2) return { x: 1, y: 0 };

  const from = vertices[vertices.length - 2]!;
  const to = vertices[vertices.length - 1]!;
  const length = Math.hypot(to.x - from.x, to.y - from.y);

  if (length < 1e-9) return { x: 1, y: 0 };

  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/**
 * Where the next corner lands, given where the pointer is.
 *
 * The canvas calls this to draw the ghost and the store calls it to place the corner, so the
 * preview cannot promise a position the click then fails to deliver — the same rule the
 * tessellation layer follows for the canvas and the validator.
 *
 * With right angles on, the pointer is projected onto whichever of the four square directions it
 * is closest to, and only the *distance* along that direction is grid-snapped. Snapping the point
 * itself to the grid afterwards would knock it back off the axis, which is the obvious way to
 * write this and quietly undoes the whole feature on a plot that is not square to the screen.
 */
export function nextDrawPoint(
  vertices: Point[],
  raw: Point,
  options: { gridSnap: boolean; rightAngle: boolean; unit: Unit },
): Point {
  const previous = vertices[vertices.length - 1];

  if (!options.rightAngle || !previous) {
    return options.gridSnap ? snapPoint(raw, options.unit) : raw;
  }

  const reference = drawReference(vertices);
  const dx = raw.x - previous.x;
  const dy = raw.y - previous.y;

  let best = reference;
  let bestReach = -Infinity;

  // Straight on, both right turns, and back the way we came.
  for (const turn of [0, 90, 180, 270]) {
    const direction = rotatePoint(reference, { x: 0, y: 0 }, turn);
    const reach = dx * direction.x + dy * direction.y;

    if (reach > bestReach) {
      bestReach = reach;
      best = direction;
    }
  }

  const distance = options.gridSnap ? snapToStep(Math.max(0, bestReach), options.unit) : bestReach;

  return { x: previous.x + best.x * distance, y: previous.y + best.y * distance };
}

/** A corner placed by measurement rather than by pointing — length, then turn. */
export function vertexFromMeasurement(
  vertices: Point[],
  distance: number,
  turnDegrees: number,
): Point | null {
  const previous = vertices[vertices.length - 1];
  if (!previous || !(distance > 0) || !Number.isFinite(turnDegrees)) return null;

  const direction = rotatePoint(drawReference(vertices), { x: 0, y: 0 }, turnDegrees);

  return { x: previous.x + direction.x * distance, y: previous.y + direction.y * distance };
}

/**
 * Which corner an edge-length edit pins, and which one it slides.
 *
 * Exported so the panel can *show* the answer. Changing one side of a closed polygon is
 * genuinely ambiguous — the same number could move either end, or re-solve the whole outline —
 * and the ambiguity stops mattering the moment the user can see which corner is about to move.
 * Deriving it here rather than duplicating the rule in the UI is what keeps the highlight
 * honest when the closing edge takes the other branch.
 */
export function edgeReflowTargets(
  vertexCount: number,
  edgeIndex: number,
): { anchorIndex: number; movedIndex: number } | null {
  if (vertexCount < 2 || edgeIndex < 0 || edgeIndex >= vertexCount) return null;

  const endIndex = (edgeIndex + 1) % vertexCount;

  // The closing edge ends on vertex A. Moving that would drag the shape's anchor and change
  // edge A->B as a side effect, so it slides its own start instead — see `reflowEdge`.
  return endIndex === 0
    ? { anchorIndex: endIndex, movedIndex: edgeIndex }
    : { anchorIndex: edgeIndex, movedIndex: endIndex };
}

export function reflowEdge<T extends Point>(
  vertices: T[],
  edgeIndex: number,
  newLength: number,
): T[] {
  const count = vertices.length;
  if (count < 2 || newLength <= 0) return vertices;
  if (edgeIndex < 0 || edgeIndex >= count) return vertices;

  const endIndex = (edgeIndex + 1) % count;
  const start = vertices[edgeIndex]!;
  const end = vertices[endIndex]!;
  const current = Math.hypot(end.x - start.x, end.y - start.y);

  // A zero-length edge has no direction to grow along.
  if (current < 1e-9) return vertices;

  const unitX = (end.x - start.x) / current;
  const unitY = (end.y - start.y) / current;
  const isClosingEdge = endIndex === 0;

  const movedIndex = isClosingEdge ? edgeIndex : endIndex;
  const moved = isClosingEdge
    ? { ...start, x: end.x - unitX * newLength, y: end.y - unitY * newLength }
    : { ...end, x: start.x + unitX * newLength, y: start.y + unitY * newLength };

  return vertices.map((vertex, index) => (index === movedIndex ? moved : vertex));
}
