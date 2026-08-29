import { boundingBox, type Point } from '../geometry/primitives.js';

/**
 * The two plot shapes worth starting from, as geometry.
 *
 * Step 1 used to open on a blank grid and require the user to draw a scaled polygon corner by
 * corner. Nothing about that gesture carries a scale, which is how a 113 x 74.5 m "garden" got
 * accepted — the user was originating a measurement from nothing. Most residential plots are
 * rectangles, so opening on a real, correctly-scaled rectangle turns the task into *adjusting* a
 * default rather than inventing one, and corner-by-corner drawing becomes the escape hatch for
 * genuinely irregular plots.
 *
 * Everything here is pure and anchored at an origin the caller supplies, so the same helpers
 * build the preset and rebuild it when a dimension changes.
 */

/** Metres. Below this the corner handles overlap and the shape stops being editable. */
export const MIN_PLOT_SIDE = 1;

export interface RectanglePlot {
  width: number;
  depth: number;
}

export interface LShapePlot {
  width: number;
  depth: number;
  /** The notch taken out of the bottom-right corner. */
  returnWidth: number;
  returnDepth: number;
}

/**
 * A small suburban back garden. Deliberately modest: a default that is too big invites the user
 * to accept it, and a plot smaller than the truth is corrected upwards without the decimal-point
 * error the sanity band exists to catch.
 */
export const DEFAULT_RECTANGLE_PLOT: RectanglePlot = { width: 12, depth: 8 };

export const DEFAULT_LSHAPE_PLOT: LShapePlot = {
  width: 14,
  depth: 10,
  returnWidth: 5,
  returnDepth: 4,
};

/** Clockwise from the top-left in the plan's +y-downwards frame, as every other outline is. */
export function rectanglePlotOutline(spec: RectanglePlot, origin: Point = { x: 0, y: 0 }): Point[] {
  const { width, depth } = spec;

  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth },
    { x: origin.x, y: origin.y + depth },
  ];
}

/**
 * Six corners, with the return cut out of the bottom-right. Which corner the notch sits in is
 * arbitrary and does not matter: the user rotates the house rather than the plot, and any L can
 * be reached from this one by dragging corners.
 */
export function lShapePlotOutline(spec: LShapePlot, origin: Point = { x: 0, y: 0 }): Point[] {
  const { width, depth, returnWidth, returnDepth } = spec;

  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth - returnDepth },
    { x: origin.x + width - returnWidth, y: origin.y + depth - returnDepth },
    { x: origin.x + width - returnWidth, y: origin.y + depth },
    { x: origin.x, y: origin.y + depth },
  ];
}

/** Whether a spec describes a shape that can actually be drawn and edited. */
export function isUsableRectangle(spec: RectanglePlot): boolean {
  return spec.width >= MIN_PLOT_SIDE && spec.depth >= MIN_PLOT_SIDE;
}

/**
 * The return has to be smaller than the plot on both axes, or the "L" is a rectangle with a
 * degenerate limb — or an outline that crosses itself.
 */
export function isUsableLShape(spec: LShapePlot): boolean {
  return (
    spec.width >= MIN_PLOT_SIDE &&
    spec.depth >= MIN_PLOT_SIDE &&
    spec.returnWidth >= MIN_PLOT_SIDE &&
    spec.returnDepth >= MIN_PLOT_SIDE &&
    spec.width - spec.returnWidth >= MIN_PLOT_SIDE &&
    spec.depth - spec.returnDepth >= MIN_PLOT_SIDE
  );
}

/* ---------------------------------------------------------------- recognising one again */

/**
 * The shape is **derived from the outline, never stored**, for the same reason zones are: a
 * remembered "this is a rectangle" flag goes stale the moment a corner is dragged, and then the
 * width field is editing a shape that no longer exists.
 *
 * The cost of deriving is that a per-edge length edit turns a rectangle into a quadrilateral and
 * the width/depth fields disappear. That is the honest report — the shape really is no longer a
 * rectangle — and it is what keeps the two editing models from contradicting each other: the
 * dimension fields move two corners because a rectangle has to stay a rectangle, and the per-edge
 * fields move one because a free-form outline has no such rule.
 */
const TOLERANCE = 1e-6;

function sameCorner(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TOLERANCE && Math.abs(a.y - b.y) < TOLERANCE;
}

function matchesOutline(points: Point[], outline: Point[]): boolean {
  return points.length === outline.length && points.every((p, i) => sameCorner(p, outline[i]!));
}

/**
 * A rectangle, whichever corner it was started from.
 *
 * Rotations of the corner list are accepted because a hand-drawn rectangle is just as much a
 * rectangle as a generated one, and a user who drew four square corners has earned the fields.
 * Winding is not: an anticlockwise outline would report the same width and depth but rebuild
 * clockwise, silently reversing the vertex order under the user's selection.
 */
export function matchRectanglePlot(points: Point[]): RectanglePlot | null {
  if (points.length !== 4) return null;

  const box = boundingBox(points);
  if (box.width < TOLERANCE || box.length < TOLERANCE) return null;

  const canonical = rectanglePlotOutline(
    { width: box.width, depth: box.length },
    { x: box.minX, y: box.minY },
  );

  for (let offset = 0; offset < canonical.length; offset += 1) {
    const rotated = canonical.map((_, i) => canonical[(i + offset) % canonical.length]!);
    if (matchesOutline(points, rotated)) return { width: box.width, depth: box.length };
  }

  return null;
}

/**
 * An L in the canonical corner order this module produces.
 *
 * Strict on purpose, and the limitation is worth stating: an L drawn by hand from a different
 * corner will not offer the dimension fields. Recognising all eight orientations would mean
 * deciding which limb is "the return" from geometry alone, and getting that wrong swaps two
 * fields under the user mid-edit — worse than not offering them.
 */
export function matchLShapePlot(points: Point[]): LShapePlot | null {
  if (points.length !== 6) return null;

  const box = boundingBox(points);
  if (box.width < TOLERANCE || box.length < TOLERANCE) return null;

  const origin = { x: box.minX, y: box.minY };
  // The notch corner is vertex 3; its offset from the far corner gives both return dimensions.
  const notch = points[3]!;
  const spec: LShapePlot = {
    width: box.width,
    depth: box.length,
    returnWidth: origin.x + box.width - notch.x,
    returnDepth: origin.y + box.length - notch.y,
  };

  if (!isUsableLShape(spec)) return null;

  return matchesOutline(points, lShapePlotOutline(spec, origin)) ? spec : null;
}
