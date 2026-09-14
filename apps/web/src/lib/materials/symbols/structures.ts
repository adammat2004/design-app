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

/**
 * A garden room: a mono-pitch roof and a glazed frontage.
 *
 * What distinguishes one from a shed in plan is not the roof — from directly above a flat roof and
 * a mono-pitch one are the same rectangle — it is the **glazing**. A garden room is a building you
 * look out of, so a band of glass down one long face with mullions across it is the whole read,
 * and the single fall of the roof is what says it is a modern box rather than a hut.
 *
 * `high` and `low` are the two long edges, high first. The fall runs from one to the other, so a
 * caller can shade the plane as one facet rather than two — there is no ridge to break it at.
 *
 * **Which face is glazed is a convention, not an inference.** The document records no door on an
 * element and no direction it faces, so this takes the local `-y` long face and says so. Guessing
 * from the house would be a derived direction nothing downstream could check, which is the class
 * of thing `openingNormal` exists to avoid.
 */
export function gardenRoomParts(
  rect: RectShape,
  glazingShare = 0.3,
): {
  plane: Point[];
  high: [Point, Point];
  low: [Point, Point];
  glazing: Point[];
  mullions: Point[][];
} {
  const at = frame(rect);
  const along = rect.width >= rect.depth;
  const hw = rect.width / 2;
  const hd = rect.depth / 2;

  // The long axis runs across the face; the fall runs along the short one.
  const faceHalf = along ? hw : hd;
  const fallHalf = along ? hd : hw;
  /*
   * A share of the depth rather than a fixed band, because a garden room's front really is mostly
   * glass and the whole read depends on it: quoted at a flat 0.35 m it was a pale stripe on a 3 m
   * building, which is the proportion of a paving margin rather than of a frontage.
   */
  const glazed = fallHalf * 2 * glazingShare;

  /** Local-frame point, with the long axis first however the rect is proportioned. */
  const local = (face: number, fall: number): Point => (along ? at(face, fall) : at(fall, face));

  const mullions: Point[][] = [];
  // Four panes' worth of divisions, spaced evenly across the face rather than at a fixed pitch:
  // a 2 m room and a 6 m one should both read as a glazed wall, not as two and eighteen panes.
  const panes = 4;
  for (let i = 1; i < panes; i += 1) {
    const face = -faceHalf + (faceHalf * 2 * i) / panes;
    mullions.push([local(face, -fallHalf), local(face, -fallHalf + glazed)]);
  }

  return {
    plane: [
      local(-faceHalf, -fallHalf),
      local(faceHalf, -fallHalf),
      local(faceHalf, fallHalf),
      local(-faceHalf, fallHalf),
    ],
    // The roof is highest over the solid back and falls towards the glass, which is how these are
    // built: the tall wall is the one you do not have to look past.
    high: [local(-faceHalf, fallHalf), local(faceHalf, fallHalf)],
    low: [local(-faceHalf, -fallHalf), local(faceHalf, -fallHalf)],
    glazing: [
      local(-faceHalf, -fallHalf),
      local(faceHalf, -fallHalf),
      local(faceHalf, -fallHalf + glazed),
      local(-faceHalf, -fallHalf + glazed),
    ],
    mullions,
  };
}

/**
 * The glazing bars of a greenhouse, across the roof's fall.
 *
 * The roof itself is `shedRoof` — a greenhouse is a pitched box, and there is no reason for a
 * second implementation of a ridge. This is the part that makes it read as glass rather than as a
 * shed: a run of fine lines at a real spacing, running from eave to ridge on both slopes.
 *
 * Spaced in metres, like the fence posts, so they stay the right density at any zoom; the caller
 * drops them when they fall closer together than a pixel or two.
 */
export function glazingBars(rect: RectShape, spacing = 0.6): Point[][] {
  const at = frame(rect);
  const along = rect.width >= rect.depth;
  const hw = rect.width / 2;
  const hd = rect.depth / 2;

  // Bars run across the ridge, so they are spaced along it.
  const ridgeHalf = along ? hw : hd;
  const fallHalf = along ? hd : hw;
  const local = (onRidge: number, fall: number): Point =>
    along ? at(onRidge, fall) : at(fall, onRidge);

  const bars: Point[][] = [];
  const step = Math.max(0.1, spacing);

  for (let x = -ridgeHalf + step; x < ridgeHalf - 1e-6; x += step) {
    bars.push([local(x, -fallHalf), local(x, fallHalf)]);
  }

  return bars;
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

/**
 * A flight of steps, as the lines between its treads.
 *
 * The tread count is **not a parameter**: it comes from `stepFlight`, which divides the element's
 * own `elevation` into whole risers. So a flight that climbs 450 mm draws three nosings and one
 * that climbs 900 draws five, and neither can disagree with the level change it serves — there is
 * no count stored anywhere to go stale.
 *
 * Returned as the nosing lines rather than as filled treads, which is how a flight is drawn on a
 * plan: the treads are the paving either side of them, and a run of alternating filled rectangles
 * reads as decking. `descending` is the direction of travel down the flight, so the nosings run
 * across it — a flight always steps down away from the thing it serves.
 */
export function stepNosings(rect: RectShape, risers: number): Point[][] {
  if (risers < 1) return [];

  const at = frame(rect);
  const hw = rect.width / 2;
  const hd = rect.depth / 2;
  const lines: Point[][] = [];

  /*
   * `risers` risers means `risers` nosings, counted from the top edge and *excluding* the bottom
   * one: the last nosing is the edge of the flight itself, which the element's own outline already
   * draws. Drawing it again doubles a line on a boundary that is often also a retaining face.
   */
  for (let i = 0; i < risers; i += 1) {
    const t = i / risers;
    const y = -hd + rect.depth * t;
    lines.push([at(-hw, y), at(hw, y)]);
  }

  return lines;
}
