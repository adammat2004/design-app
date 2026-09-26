import {
  clipToHalfPlane,
  type DesiredFeature,
  type GardenBrief,
  type PrivacyStrategy,
} from '@garden-studio/schema';
import { MIN_FILL_SIDE } from '../fill-limits.js';
import { hostFloor } from '../furnishings.js';

/**
 * What a template hands back: the plan in the frame's own metres, before anything is fitted.
 *
 * A sketch is opinion, not geometry of record. It says where the terrace goes, what shape the
 * lawn is, and which *slots* the requested features should be tried in, in order. `fit.ts` turns
 * each slot into a legal rectangle or gives up; the sketch never touches the boundary or the
 * validator, which is what keeps the three templates pure functions a test can run without a
 * database.
 */

export interface LocalPoint {
  u: number;
  v: number;
}

/** A rectangle in the frame: `u` out from the wall, `v` along it. */
export interface LocalRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export type LocalShape =
  | { kind: 'rect'; rect: LocalRect; cornerRadius: number }
  /** `styleCorners`: round the corners the way the style rounds a rectangle (a notched panel). */
  | { kind: 'polygon'; points: LocalPoint[]; styleCorners?: boolean };

export type SlotKind =
  | 'terrace'
  | 'beside-terrace'
  | 'terrace-end'
  | 'terrace-corner'
  | 'far-room'
  | 'lawn-far'
  | 'utility'
  | 'utility-2'
  | 'axis-end';

export interface Slot {
  id: string;
  kind: SlotKind;
  /**
   * The functional zone this slot belongs to — the dining room, the utility corner, the destination.
   *
   * A slot kind was always a zone and a position within it said in one word (`terrace-end` is "the
   * dining room, at the end of the terrace"), and nothing wrote it down. With it written down a
   * feature can be assigned to a *room* while the fitter goes on working in slots, which is what
   * lets the grouping principle ask whether the dining room holds together.
   *
   * Optional because `ZONE_BY_SLOT` derives it from the kind for every template that does not set
   * it, so nothing had to change to gain it.
   */
  zoneId?: string;
  /** Where the feature's centre goes, in the frame. */
  anchor: LocalPoint;
  /** The most room the slot has, so a footprint is scaled to what will fit before fitting. */
  maxSize: { width: number; depth: number };
  /**
   * The least the thing in this slot may be and still be the thing that was asked for. `fitInSlot`
   * refuses rather than shrink below it: a pergola nothing can sit under is not a pergola, and the
   * card should say the feature was not included rather than draw one in name only.
   */
  minSize?: { width: number; depth: number };
  /** Turn the footprint a quarter so its long side runs along `v` rather than `u`. */
  turn?: boolean;
  /**
   * Why a thing in this slot is here, from the composition's vocabulary. Set by a composed sketch
   * and stamped onto whatever lands in the slot; absent on the compositions still drawn by hand.
   */
  purpose?: string;
}

/**
 * How much a route matters, which decides what it may cross.
 *
 * `primary` and `secondary` routes are the ways people actually move — to the shed with the mower,
 * down to the seat at the end — and a composed plan gives them a corridor round the open ground
 * rather than across it, so the lawn is an obstacle to them. A `decorative` route is walked for its
 * own sake and may cross what it likes, which is the difference between a path and a scar.
 */
export type RouteTier = 'primary' | 'secondary' | 'decorative';

export interface SketchPath {
  /**
   * A point in the frame, or the terrace's own edge — the point on it nearest the destination,
   * so a path to the shed leaves the terrace's side rather than running along its front.
   */
  from: LocalPoint | { terrace: true };
  /**
   * A slot id, or the gate. Resolved to a world point once the slot is filled; `or` lists the
   * slots to route to instead when nothing took the first one, so a plan whose far room stayed
   * empty still gets its path to the play area at the bottom of the lawn.
   */
  to: { slot: string; or?: string[] } | { gate: true };
  /** Intermediate points for a curved or dog-legged route, in the frame. */
  via?: LocalPoint[];
  name: string;
  /** Absent on a hand-drawn composition, which reads as `secondary` and may cross the lawn. */
  tier?: RouteTier;
  purpose?: string;
  /**
   * The route this one branches off, by name. A branch starts on that route's line, so the two
   * strips overlap at the junction by construction — the way two paved paths join — and the router
   * is told to allow it. Laid after the route it names, or not at all.
   */
  branch?: string;
}

/**
 * What a composed sketch knows that a hand-drawn one does not.
 *
 * Present only on a sketch produced by `design/composition/`. Its presence is what switches the
 * realisation to the composed rules: the open space was reserved first, so beds are cut round the
 * lawn rather than the lawn round the beds; a primary route may not cross the lawn; trees are
 * planted where the composition put them for the reason it gave, and nowhere else.
 */
export interface ComposedFacts {
  language: 'rectilinear' | 'soft_organic' | 'formal_symmetric';
  /** Why each of `LayoutSketch.trees` is there, in the same order. */
  treeRoles: { role: 'focal' | 'framing' | 'screening' | 'backdrop'; purpose: string }[];
  /** Why each of `LayoutSketch.beds` is there, in the same order. */
  bedPurposes: string[];
  /** The decisions the composition took, each a sentence a person could disagree with. */
  decisions: { kind: string; text: string }[];
}

export interface LayoutSketch {
  beds: { name: string; shape: LocalShape }[];
  template: TemplateId;
  terrace: LocalRect | null;
  lawn: LocalShape | null;
  /** What the lawn panel is made of: grass, or gravel where grass is forbidden. */
  lawnCategory: 'lawn' | 'gravel-mulch';
  slots: Slot[];
  paths: SketchPath[];
  /** Framing trees, tried in order until the plot has had enough. */
  trees: LocalPoint[];
  /** The formal template's paved line down the middle, as a strip. */
  axisPath: LocalRect | null;
  /**
   * Distances out from the door at which the axis path has a vertex of its own: where it passes
   * something it serves, so it is seen to reach it rather than run past it from end to end.
   */
  axisStops?: number[];
  /** True when the room is too shallow for a lawn: terrace only. */
  courtyard: boolean;
  /** Set by a composed sketch. See `ComposedFacts`. */
  composed?: ComposedFacts;
}

export type TemplateId = 'rectilinear' | 'curved' | 'formal';

export interface SketchRequest {
  features: DesiredFeature[];
  /** `constraints.scale.sizeFactor`, 0.6–2.5. */
  scale: number;
  style: GardenBrief['style'];
  lawnAllowed: boolean;
  /** Which side of the frame the gate is on, in `v`: negative is left when looking out. */
  gateSide: 'left' | 'right' | null;
  houseWallLength: number;
  /** The door's width, so the terrace always covers it. */
  doorWidth: number | null;
  /**
   * Rooms beyond what was asked for that the plot can carry: a second seating area on a big plot,
   * a lounge where the brief and budget want one. A composed sketch reserves a bay for each, so the
   * surplus lands in the composition rather than wherever a sampler found room. Both the preview
   * and the realisation pass the same number, or the two would compose different gardens.
   */
  extraRooms?: number;
  /** The view from the doors, in the frame. A composed sketch keeps the utility bays out of it. */
  view?: { cone: LocalPoint[]; axisEnd: LocalPoint } | null;
  /** Where the side gate is, in the frame, so the way in from it can be kept clear of planting. */
  gate?: LocalPoint | null;
  /**
   * The features this concept's brief calls essential. A composition gives the lawn up to these
   * rather than refuse them: the lawn is the thing the rooms stand round, but not at the price of
   * the room the garden is for.
   */
  essential?: DesiredFeature[];
  /**
   * What the concept's brief asks the planting to screen. Where it asks to screen the neighbours or
   * to enclose the garden, a composition plants both sides deep against the fence and runs any path
   * inside them — the planting's depth follows its role rather than one band all round.
   */
  privacy?: PrivacyStrategy;
  /**
   * The sides whose boundary is too low to screen a seat (`lowSides`). A screening bed goes only
   * against these: a tall fence already screens, and planting in front of it only costs the lawn.
   */
  lowSides?: ('left' | 'right')[];
}

export interface Room {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /**
   * The room's outline in the frame, when the caller has one. A box alone describes an L-plot as
   * its full width and depth at once, which no part of it is; `roomBehind` reads the outline to
   * find the part that actually lies behind the terrace.
   */
  polygon?: LocalPoint[];
}

/**
 * The room from `uFrom` outwards, as a box. On a rectangle this is the same box with a nearer
 * edge; on an L-plot it is the deep limb alone, which is where the lawn and the far rooms belong.
 * The first version sized the kidney lawn on the whole L and clipped it, and most of it fell in
 * the shallow limb beside the house.
 */
export function roomBehind(room: Room, uFrom: number): Room {
  const uMin = Math.max(room.uMin, uFrom);
  if (!room.polygon || room.polygon.length < 3) return { ...room, uMin };

  const clip = (from: number) =>
    clipToHalfPlane(
      room.polygon!.map(({ u, v }) => ({ x: u, y: v })),
      { x: from, y: 0 },
      { x: 1, y: 0 },
    );

  const kept = clip(uFrom);
  if (kept.length < 3) return { ...room, uMin };

  /*
   * The width is measured a token depth further in, because an L's inner corner sits *on* the
   * cut: clipping at exactly `uFrom` keeps the zero-depth edge across the full width of the plot
   * and reports the shallow limb as room the lawn can use. Falls back to the cut itself when the
   * room is barely deeper than the terrace.
   */
  const measured = clip(uFrom + WIDTH_PROBE);
  const extent = measured.length >= 3 ? measured : kept;

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const point of extent) {
    if (point.y < vMin) vMin = point.y;
    if (point.y > vMax) vMax = point.y;
  }
  const uMax = Math.max(...kept.map((point) => point.x));

  return { uMin, uMax, vMin, vMax, polygon: kept.map(({ x, y }) => ({ u: x, v: y })) };
}

/** How far past the cut the width of the room behind is measured, in metres. */
const WIDTH_PROBE = 0.5;

/* ---------------------------------------------------------------- shared numbers */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How deep the planting round the edges is. Never under `MIN_FILL_SIDE`, or it drops out.
 *
 * Quoted at the same 2.2 m `BORDER_WIDTH` is, and capped at 3.5 rather than 2.5, for the reason
 * given there: a metre and a half holds two ranks of plants, and a layered border needs three. The
 * cap is what a border stays *reachable* at from one side — past about three and a half metres you
 * are standing in it to weed the back, which is a planting a designer only draws where there is a
 * path behind it.
 */
export function borderDepth(scale: number): number {
  return clamp(2.2 * scale, MIN_FILL_SIDE, 3.5);
}

/**
 * The border depth that fits across this span while leaving the open panel its floor.
 *
 * **The lawn's floor wins over the border's profile**, which is the rule that had to be written the
 * moment `borderDepth` went from 1.5 m to 2.2. Those seventy centimetres come off the lawn, and on
 * a small garden they took it under `LAWN_FLOOR` — so `isCourtyard` said the plot could not hold a
 * lawn at all and the whole garden came back paved. A deeper border producing a worse plan is the
 * change arguing against itself; what a border may take is what is left over, down to its own
 * sliver guard and no further.
 *
 * `across` is the span the border shares with the panel, and `panelDepth` the panel's other
 * dimension where the caller knows it. Both are needed because `LAWN_FLOOR` is an area as well as a
 * minimum side: leaving the lawn 2.5 m across a 2.5 m deep strip leaves 6 m², which `lawnViable`
 * rightly refuses, and the garden comes back paved anyway. Below the point where even
 * `BED_MIN_DEPTH` leaves a viable lawn the answer is the guard, and the plot really is a courtyard.
 */
export function borderIn(scale: number, across: number, panelDepth?: number): number {
  const needed =
    panelDepth && panelDepth > 0
      ? Math.max(LAWN_FLOOR.minDimension, LAWN_FLOOR.area / panelDepth)
      : LAWN_FLOOR.minDimension;
  return Math.max(BED_MIN_DEPTH, Math.min(borderDepth(scale), across - needed));
}

/* ---------------------------------------------------------------- the floors */

/**
 * The sizes below which a thing stops being the thing, derived rather than declared.
 *
 * ```
 *   FURNISHINGS.seating[0] = sofa-set 3.0 × 2.4 ─► + 2 × MARGIN ─► TERRACE_FLOOR 3.6 × 3.0
 *   smallest FURNISHINGS.pergola = dining-set-4 2.4 × 2.4 ─► + 2 × MARGIN ─► PERGOLA_FLOOR 3.0 × 3.0
 * ```
 *
 * A terrace is a room for a table: the thing it exists to hold sets its floor, and the floor
 * moves if the furnishing list does. The share cap below never overrides it — the first version
 * capped the terrace at a third of the room with no floor, and a three-metre garden got a
 * one-metre terrace across the whole width of the house.
 */
export const TERRACE_FLOOR = hostFloor('seating', 'primary');
export const PERGOLA_FLOOR = hostFloor('pergola', 'smallest');

/** The terrace never takes more than this share of the room's depth, above its floor. */
export const TERRACE_MAX_SHARE = 0.35;

/**
 * A lawn narrower than this anywhere is a strip you mow, not a panel you use; smaller than the
 * area, a rug. Below either the room is a courtyard and the ground is paved or gravelled instead.
 */
export const LAWN_FLOOR = { minDimension: 2.5, area: 12 };

/** The lawn runs to within this of the gate-side fence: a mowing edge, not a border. */
export const MOWING_STRIP = 0.35;

/** A sketched bed is never thinner than the sliver guard would throw away. */
export const BED_MIN_DEPTH = MIN_FILL_SIDE;

/** The terrace's floor, capped by the room: a narrow room still gets a terrace, a narrower one. */
export function terraceFloor(room: Room): { width: number; depth: number } {
  return {
    width: Math.max(0, Math.min(TERRACE_FLOOR.width, room.vMax - room.vMin - 0.4)),
    depth: Math.max(0, Math.min(TERRACE_FLOOR.depth, room.uMax - Math.max(room.uMin, 0))),
  };
}

export function lawnViable(width: number, depth: number): boolean {
  return (
    width >= LAWN_FLOOR.minDimension &&
    depth >= LAWN_FLOOR.minDimension &&
    width * depth >= LAWN_FLOOR.area
  );
}

/**
 * The planted gap between the terrace and the lawn: a stride at most, and nothing at all when the
 * room cannot spare it after a minimum lawn and a minimum rear bed.
 */
export function lawnGap(scale: number, roomDepth: number, terraceEnd: number): number {
  return clamp(roomDepth - terraceEnd - LAWN_FLOOR.minDimension - BED_MIN_DEPTH, 0, 0.6 * scale);
}

/** Where the lawn starts, out from the wall. */
export function lawnStart(scale: number, roomDepth: number, terraceEnd: number): number {
  return terraceEnd + lawnGap(scale, roomDepth, terraceEnd);
}

/**
 * The rear border's depth: everything beyond a minimum lawn, up to twice the border depth. One
 * function, read by the lawn's far edge and by the rear bed alike — they used to be `2b` and `b`
 * in two files, and the difference showed as a band of base turf between the lawn and the bed.
 */
export function rearBedDepth(scale: number, roomDepth: number, terraceEnd: number): number {
  const start = lawnStart(scale, roomDepth, terraceEnd);
  return clamp(roomDepth - start - LAWN_FLOOR.minDimension, BED_MIN_DEPTH, 2 * borderDepth(scale));
}

/** Where the lawn ends and the rear bed begins. */
export function lawnEnd(scale: number, roomDepth: number, terraceEnd: number): number {
  return roomDepth - rearBedDepth(scale, roomDepth, terraceEnd);
}

/**
 * Where a slot goes in the strip between the terrace and the far border.
 *
 * A far slot used to be anchored from the back fence alone — "2.3 m in from the border" — which
 * on a nine-metre garden with a four-metre terrace put the play area's anchor *inside* the
 * terrace, where no nudge could rescue it, and every plan that size lost its lawn feature to the
 * sampler. The slot is sized to what is actually free behind the terrace and its centre held in
 * that strip, so a shallow garden gets a smaller thing in the right place rather than nothing.
 */
export function behindTerrace(
  uNear: number,
  uFar: number,
  wantDepth: number,
): { u: number; depth: number } {
  const free = Math.max(0.4, uFar - uNear - 0.4);
  const depth = Math.min(wantDepth, free);
  return { u: uFar - depth / 2 - Math.min(0.2, (free - depth) / 2), depth };
}

/**
 * The terrace's depth out from the door: a room for a table, never most of the garden.
 *
 * Grows with the square root of the scale — a terrace on a big plot is bigger, not proportionally
 * bigger — and never past a third of the room, so the lawn stays the largest thing in it. But the
 * share cap sits *above* the floor, never below it: the floor is the table, and the only thing
 * that can cap the table is the room itself. A three-metre-deep garden gets a three-metre terrace
 * and no lawn, which is what a three-metre-deep garden is.
 *
 * ```
 *   want   = clamp(3.6 √scale, floor, 5.5)
 *   capped = min(want, 0.35 × roomDepth)
 *   depth  = max(capped, min(floor, roomDepth))
 * ```
 */
export function terraceDepth(scale: number, roomDepth: number, factor = 1): number {
  const want = clamp(3.6 * Math.sqrt(scale) * factor, TERRACE_FLOOR.depth, 5.5);
  const capped = Math.min(want, TERRACE_MAX_SHARE * roomDepth);
  return Math.max(capped, Math.min(TERRACE_FLOOR.depth, roomDepth));
}

/**
 * The terrace's width along the wall: the house's width, or a good table's worth, never under
 * the floor — and the floor is capped by the room exactly as the depth's is, so a room 3.7 m wide
 * still gets a terrace rather than a refusal.
 */
export function terraceWidth(request: SketchRequest, room: Room): number {
  const roomWidth = room.vMax - room.vMin;
  const floor = terraceFloor(room).width;
  return clamp(
    Math.max(request.houseWallLength, 5.2 * request.scale),
    floor,
    Math.max(floor, roomWidth - 0.8),
  );
}

/**
 * A room that cannot hold a viable lawn behind its terrace is a courtyard: the terrace takes it,
 * and the far room is whatever is left. "Viable" is `LAWN_FLOOR`, measured on the strip left after
 * the terrace, the gap and the rear bed, and across the room less one border and a mowing edge.
 */
export function isCourtyard(
  scale: number,
  roomDepth: number,
  roomWidth: number,
  factor = 1,
): boolean {
  const T = terraceDepth(scale, roomDepth, factor);
  const depth = lawnEnd(scale, roomDepth, T) - lawnStart(scale, roomDepth, T);
  /*
   * Measured against the **thinnest** border, not the one the style would like.
   *
   * Whether this room can hold a lawn is a fact about the room; how deep the borders round it are
   * is a preference, and `borderIn` already gives the preference way to the lawn's floor. Asking
   * this question at the preferred depth made the two disagree the moment `borderDepth` went to
   * 2.2 m: a 9 × 10 m garden was reported as unable to hold a lawn, the courtyard composition
   * claimed it on that basis, and a plan that had been 38% hard came back 82% — paved corner to
   * corner because the border we *wanted* was seventy centimetres deeper.
   */
  const width = roomWidth - BED_MIN_DEPTH - MOWING_STRIP;
  return !lawnViable(width, depth);
}

/**
 * The terrace across the door: centred on the door, held inside the room's width, and always
 * at least as wide as the door itself. `v` is measured from the door, so 0 is the door's centre.
 */
export function terraceRect(request: SketchRequest, room: Room, factor = 1): LocalRect {
  const depth = terraceDepth(request.scale, room.uMax - Math.max(room.uMin, 0), factor);
  const width = terraceWidth(request, room);
  const [v0, v1] = clampToRoom(width, room, (request.doorWidth ?? 0) / 2);
  return { u0: Math.max(room.uMin, 0), u1: Math.max(room.uMin, 0) + depth, v0, v1 };
}

/**
 * A span of `width` centred on the door, shifted along the wall so it stays inside the room, but
 * never off the door. Shared by every template that places a terrace, symmetric or not.
 */
export function clampToRoom(width: number, room: Room, doorHalf: number): [number, number] {
  const half = width / 2;
  let v0 = -half;
  let v1 = half;
  if (v0 < room.vMin + 0.2) {
    const shift = room.vMin + 0.2 - v0;
    v0 += shift;
    v1 += shift;
  }
  if (v1 > room.vMax - 0.2) {
    const shift = v1 - (room.vMax - 0.2);
    v0 -= shift;
    v1 -= shift;
  }
  return [Math.min(v0, -doorHalf), Math.max(v1, doorHalf)];
}

/** The terrace's own slot: its rectangle as the ceiling, the room-capped floor as the floor. */
export function terraceSlot(terrace: LocalRect, room: Room): Slot {
  return {
    id: 'terrace',
    kind: 'terrace',
    anchor: rectCentre(terrace),
    maxSize: rectSize(terrace),
    minSize: terraceFloor(room),
  };
}

/**
 * The slot at the end of the terrace, along the wall: the dining pergola. Its depth is never less
 * than the pergola's own floor, so a shallow terrace does not starve the pergola beside it — which
 * is how a one-metre terrace used to come with a one-and-a-half-metre pergola.
 */
export function terraceEndSlot(terrace: LocalRect, side: 'left' | 'right', scale: number): Slot {
  const T = terrace.u1 - terrace.u0;
  return {
    id: 'terrace-end',
    kind: 'terrace-end',
    anchor: {
      u: terrace.u0 + T / 2,
      v: side === 'left' ? terrace.v0 - 1.9 * scale : terrace.v1 + 1.9 * scale,
    },
    maxSize: { width: 3.6 * scale, depth: Math.max(PERGOLA_FLOOR.depth, T) },
    minSize: PERGOLA_FLOOR,
  };
}

export function rectCentre(rect: LocalRect): LocalPoint {
  return { u: (rect.u0 + rect.u1) / 2, v: (rect.v0 + rect.v1) / 2 };
}

export function rectSize(rect: LocalRect): { width: number; depth: number } {
  return { width: rect.v1 - rect.v0, depth: rect.u1 - rect.u0 };
}
