import { polygonArea, polygonIsSimple, type Point } from '../geometry/primitives.js';
import { polylineLength } from '../geometry/shapes.js';
import { MAX_CORNER_RADIUS, type PlanGeometry } from './features.js';

/**
 * Editing a shape corner by corner, as pure functions of its geometry.
 *
 * Step 2 had these as wrappers round a `PlacedFeature`, and step 5 had none at all — a generated lawn
 * or path could be moved but never re-drawn. Lifted here so both editors, and the AI's own reshape,
 * edit an outline by one set of rules: the same minimum corner count, the same refusal of an outline
 * that folds through itself, the same smallest thing that is still a shape.
 *
 * Every edit returns a new geometry or `null`, never a clamped one: a vertex that cannot go where it
 * was dragged stops there and says why, which is the rule every drag in this editor follows.
 */

/**
 * The corner points a user can drag, for the shapes that have them. Points and rectangles return
 * null — a rectangle is reshaped by its handles, not corner by corner.
 *
 * These are the authored points, before rounding: rounding is a property of the shape, not something
 * anybody edits one corner at a time.
 */
export function geometryVertices(geometry: PlanGeometry): Point[] | null {
  if (geometry.kind === 'polygon' || geometry.kind === 'polyline') return geometry.points;
  return null;
}

export function withGeometryVertices(geometry: PlanGeometry, points: Point[]): PlanGeometry {
  if (geometry.kind !== 'polygon' && geometry.kind !== 'polyline') return geometry;
  return { ...geometry, points };
}

/** Below this a polygon is no longer an area and a line is no longer a line. */
export function minimumGeometryVertices(geometry: PlanGeometry): number {
  return geometry.kind === 'polygon' ? 3 : 2;
}

/** The smallest outline that is still a surface somebody could lay, in square metres. */
export const MIN_EDITED_AREA = 0.25;
/** The shortest line that is still a path, in metres. */
export const MIN_EDITED_LENGTH = 0.5;

/**
 * Whether an edited outline is still a shape.
 *
 * A polygon must not fold through itself — a bow tie has an ordinary vertex list and a quietly wrong
 * area, so nothing downstream would report it, which is why `setEdgeLength` on step 1 and the AI's
 * `reshape` already refuse one. Step 2's corner drag never checked, so a feature could be dragged
 * into a figure of eight; this is the check both editors now share. Below the minimums a shape is a
 * sliver the user did not mean to make.
 */
export function vertexEditIsValid(geometry: PlanGeometry): boolean {
  if (geometry.kind === 'polygon') {
    return (
      geometry.points.length >= 3 &&
      polygonIsSimple(geometry.points) &&
      polygonArea(geometry.points) >= MIN_EDITED_AREA
    );
  }
  if (geometry.kind === 'polyline') {
    return geometry.points.length >= 2 && polylineLength(geometry.points) >= MIN_EDITED_LENGTH;
  }
  return true;
}

/** Why a corner edit was refused, in the words the editor shows. */
export function vertexEditRefusal(geometry: PlanGeometry): string | null {
  if (vertexEditIsValid(geometry)) return null;
  if (geometry.kind === 'polygon' && !polygonIsSimple(geometry.points)) {
    return 'That outline would cross itself.';
  }
  /* A line — a path or a fence — is too short; anything else is too small. */
  return geometry.kind === 'polyline' ? 'That line would be too short.' : 'That shape would be too small.';
}

export function moveVertexAt(geometry: PlanGeometry, index: number, to: Point): PlanGeometry | null {
  const points = geometryVertices(geometry);
  if (!points || index < 0 || index >= points.length) return null;
  const next = withGeometryVertices(
    geometry,
    points.map((point, at) => (at === index ? { x: to.x, y: to.y } : point)),
  );
  return vertexEditIsValid(next) ? next : null;
}

/** A new corner on the edge that starts at `edgeIndex`, at `at`. */
export function insertVertexAt(geometry: PlanGeometry, edgeIndex: number, at: Point): PlanGeometry | null {
  const points = geometryVertices(geometry);
  if (!points || edgeIndex < 0 || edgeIndex >= points.length) return null;
  /* A polyline's last point starts no edge — there is nothing after it to split. */
  if (geometry.kind === 'polyline' && edgeIndex >= points.length - 1) return null;
  const next = withGeometryVertices(geometry, [
    ...points.slice(0, edgeIndex + 1),
    { x: at.x, y: at.y },
    ...points.slice(edgeIndex + 1),
  ]);
  return vertexEditIsValid(next) ? next : null;
}

export function removeVertexAt(geometry: PlanGeometry, index: number): PlanGeometry | null {
  const points = geometryVertices(geometry);
  if (!points || index < 0 || index >= points.length) return null;
  if (points.length <= minimumGeometryVertices(geometry)) return null;
  const next = withGeometryVertices(
    geometry,
    points.filter((_, at) => at !== index),
  );
  return vertexEditIsValid(next) ? next : null;
}

/** A polygon's corner radius, clamped to what the renderer and the validator both draw. */
export function withCornerRadius(geometry: PlanGeometry, radius: number): PlanGeometry {
  if (geometry.kind !== 'polygon' || !Number.isFinite(radius)) return geometry;
  const clamped = Math.min(MAX_CORNER_RADIUS, Math.max(0, radius));
  if (clamped === geometry.cornerRadius) return geometry;
  return { ...geometry, cornerRadius: clamped };
}

/** How many authored corners a shape has, for the question "did an edit renumber its sides". */
export function authoredCornerCount(geometry: PlanGeometry): number {
  switch (geometry.kind) {
    case 'polygon':
      return geometry.points.length;
    case 'rect':
      return 4;
    case 'polyline':
      /* A path's sides are left and right whatever its length — see `side-chains.ts`. */
      return 2;
    case 'point':
      return 1;
  }
}
