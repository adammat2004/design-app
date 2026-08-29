import type { Point, Polygon } from '@garden-studio/schema';

export interface CanvasTransform {
  /** Pixels per metre. */
  scale: number;
  offsetX: number;
  offsetY: number;
  stageWidth: number;
  stageHeight: number;
}

export interface StageSize {
  width: number;
  height: number;
  padding: number;
}

/**
 * Fits the garden into the stage. Gardens vary a lot in size, so the scale is derived from
 * the boundary's bounding box rather than fixed, and both axes share one scale so the plan
 * stays to proportion.
 */
export function fitTransform(boundary: Polygon, stage: StageSize): CanvasTransform {
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const widthMetres = Math.max(...xs) - minX;
  const depthMetres = Math.max(...ys) - minY;

  const usableWidth = stage.width - stage.padding * 2;
  const usableHeight = stage.height - stage.padding * 2;

  const scale = Math.min(
    widthMetres > 0 ? usableWidth / widthMetres : usableWidth,
    depthMetres > 0 ? usableHeight / depthMetres : usableHeight,
  );

  // Centre whichever axis has slack left over.
  const offsetX = stage.padding + (usableWidth - widthMetres * scale) / 2 - minX * scale;
  const offsetY = stage.padding + (usableHeight - depthMetres * scale) / 2 - minY * scale;

  return { scale, offsetX, offsetY, stageWidth: stage.width, stageHeight: stage.height };
}

export function metresToPx(point: Point, t: CanvasTransform): Point {
  return { x: point.x * t.scale + t.offsetX, y: point.y * t.scale + t.offsetY };
}

/** Converts a stage click back into garden coordinates. */
export function pxToMetres(point: Point, t: CanvasTransform): Point {
  return { x: (point.x - t.offsetX) / t.scale, y: (point.y - t.offsetY) / t.scale };
}

/** Flattens a polygon into the `[x, y, x, y, ...]` array Konva's Line expects. */
export function polygonToKonvaPoints(polygon: Polygon, t: CanvasTransform): number[] {
  return polygon.flatMap((point) => {
    const { x, y } = metresToPx(point, t);
    return [x, y];
  });
}

/** Nearest point to `point` on the segment `start`-`end`, used to snap the door to its edge. */
export function closestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return { ...start };

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));

  return { x: start.x + clamped * dx, y: start.y + clamped * dy };
}

/**
 * The px rectangle a press-drag-release gesture has swept out so far.
 *
 * These last three are plain pixel arithmetic rather than anything Konva draws, and they live
 * here so the modules that need them — the label layer, the viewport hook — do not have to pull
 * in react-konva, whose Node build requires the native `canvas` package and breaks under test.
 */
export function rubberBandRect(band: { start: Point; current: Point }, transform: CanvasTransform) {
  const a = metresToPx(band.start, transform);
  const b = metresToPx(band.current, transform);

  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Overlay chrome is drawn in HTML, so anything well off the stage is simply not rendered. */
export function isOnScreen(at: Point, size: { width: number; height: number }): boolean {
  return at.x >= -40 && at.y >= -40 && at.x <= size.width + 40 && at.y <= size.height + 40;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
