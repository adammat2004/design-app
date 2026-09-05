import type { Point } from '@garden-studio/schema';

/**
 * The geometry behind the drawn structures: a pergola's posts, a shed's roof, a gazebo's hips, a
 * raised bed's rails.
 *
 * Pure point functions in world metres, like `canopy.ts`, for the same reason: the Konva canvas
 * and the plan composer both draw from them, and neither can be tested without a browser unless
 * the geometry is separable from the drawing. Structures are drawn rather than photographed
 * because their size varies with the element — a pergola is whatever rectangle the placer gave
 * it, and a sprite stretched to fit would show its posts in the wrong places.
 *
 * Every function takes the element's rect and works in its local frame, then rotates about the
 * centre — the same convention as `rectToPolygon` and `beamLines`.
 */

export interface RectShape {
  centre: Point;
  width: number;
  depth: number;
  rotation: number;
}

function frame(rect: RectShape): (x: number, y: number) => Point {
  const radians = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return (x, y) => ({
    x: rect.centre.x + x * cos - y * sin,
    y: rect.centre.y + x * sin + y * cos,
  });
}

function square(
  at: (x: number, y: number) => Point,
  cx: number,
  cy: number,
  half: number,
): Point[] {
  return [
    at(cx - half, cy - half),
    at(cx + half, cy - half),
    at(cx + half, cy + half),
    at(cx - half, cy + half),
  ];
}

/** The four corner posts of a pergola, as rings. `postSize` is the post's side in metres. */
export function pergolaPosts(rect: RectShape, postSize = 0.15): Point[][] {
  const at = frame(rect);
  const hw = rect.width / 2 - postSize / 2;
  const hd = rect.depth / 2 - postSize / 2;
  const half = postSize / 2;

  return [
    square(at, -hw, -hd, half),
    square(at, hw, -hd, half),
    square(at, hw, hd, half),
    square(at, -hw, hd, half),
  ];
}

/**
 * A pitched roof: the ridge along the longer axis and the two slopes either side of it, as rings.
 *
 * Which slope is lit is the caller's decision from the pass's light — the geometry only says
 * where the two are. Returned in a fixed order (the slope on the negative side of the ridge
 * first) so the caller can tell them apart.
 */
export function shedRoof(rect: RectShape): { ridge: [Point, Point]; slopes: [Point[], Point[]] } {
  const at = frame(rect);
  const along = rect.width >= rect.depth;
  const hw = rect.width / 2;
  const hd = rect.depth / 2;

  if (along) {
    return {
      ridge: [at(-hw, 0), at(hw, 0)],
      slopes: [
        [at(-hw, -hd), at(hw, -hd), at(hw, 0), at(-hw, 0)],
        [at(-hw, 0), at(hw, 0), at(hw, hd), at(-hw, hd)],
      ],
    };
  }

  return {
    ridge: [at(0, -hd), at(0, hd)],
    slopes: [
      [at(-hw, -hd), at(0, -hd), at(0, hd), at(-hw, hd)],
      [at(0, -hd), at(hw, -hd), at(hw, hd), at(0, hd)],
    ],
  };
}

/**
 * A hipped roof: four facets meeting at the centre. In order: top, right, bottom, left, so the
 * caller can light the two facing the sun.
 */
export function gazeboRoof(rect: RectShape): Point[][] {
  const at = frame(rect);
  const hw = rect.width / 2;
  const hd = rect.depth / 2;
  const apex = at(0, 0);

  return [
    [at(-hw, -hd), at(hw, -hd), apex],
    [at(hw, -hd), at(hw, hd), apex],
    [at(hw, hd), at(-hw, hd), apex],
    [at(-hw, hd), at(-hw, -hd), apex],
  ];
}

/** The outer and inner rings of a raised bed's timber rails. */
export function raisedBedRails(
  rect: RectShape,
  railWidth = 0.08,
): { outer: Point[]; inner: Point[] } {
  const at = frame(rect);
  const hw = rect.width / 2;
  const hd = rect.depth / 2;
  const iw = Math.max(0.05, hw - railWidth);
  const id = Math.max(0.05, hd - railWidth);

  return {
    outer: [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)],
    inner: [at(-iw, -id), at(iw, -id), at(iw, id), at(-iw, id)],
  };
}

/**
 * Which of two opposite faces is towards the light, given the outward normals of the first.
 *
 * `normal` is the direction the first slope or facet faces, in world metres; the light is a unit
 * vector towards the sun. Positive means the first is lit.
 */
export function facesLight(normal: Point, light: Point): boolean {
  return normal.x * light.x + normal.y * light.y > 0;
}

/** The outward normal of a rect's local +y face (the second shed slope), rotated with it. */
export function rectNormal(rect: RectShape, local: Point): Point {
  const radians = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos };
}
