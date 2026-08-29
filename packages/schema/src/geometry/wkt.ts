import type { Point } from './primitives.js';

/** Coordinates are rounded to micrometres so WKT never receives exponent notation. */
function formatCoord(value: number): string {
  const rounded = Number(value.toFixed(6));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(6);
}

/** Polygon -> WKT, closing the ring. */
export function polygonToWkt(polygon: Point[]): string {
  const ring = [...polygon, polygon[0]!];
  const coords = ring.map((p) => `${formatCoord(p.x)} ${formatCoord(p.y)}`).join(', ');
  return `POLYGON((${coords}))`;
}

/** Two points -> LINESTRING WKT. */
export function lineToWkt(start: Point, end: Point): string {
  return `LINESTRING(${formatCoord(start.x)} ${formatCoord(start.y)}, ${formatCoord(end.x)} ${formatCoord(end.y)})`;
}

/** Point -> WKT. */
export function pointToWkt(point: Point): string {
  return `POINT(${formatCoord(point.x)} ${formatCoord(point.y)})`;
}
