import { clipToHalfPlane, type DesiredFeature, type GardenBrief } from '@garden-studio/schema';

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
  /** Where the feature's centre goes, in the frame. */
  anchor: LocalPoint;
  /** The most room the slot has, so a footprint is scaled to what will fit before fitting. */
  maxSize: { width: number; depth: number };
  /** Turn the footprint a quarter so its long side runs along `v` rather than `u`. */
  turn?: boolean;
}

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
  /** True when the room is too shallow for a lawn: terrace only. */
  courtyard: boolean;
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

/** How deep the planting round the edges is. Never under `MIN_FILL_SIDE`, or it drops out. */
export function borderDepth(scale: number): number {
  return clamp(1.5 * scale, 1.2, 2.5);
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
 * The terrace's depth out from the door: a room for a table, never most of the garden. Grows with
 * the square root of the scale — a terrace on a big plot is bigger, not proportionally bigger —
 * and never past a third of the room, so the lawn stays the largest thing in it. At 4 × scale it
 * took 5.7 m of a 16 m garden and, with the border and the shed's bay, left the lawn 3 m deep.
 */
export function terraceDepth(scale: number, roomDepth: number): number {
  return Math.min(clamp(3.6 * Math.sqrt(scale), 2.4, 5), 0.35 * roomDepth);
}

/** The terrace's width along the wall: the house's width, or a good table's worth. */
export function terraceWidth(request: SketchRequest, room: Room): number {
  const roomWidth = room.vMax - room.vMin;
  return clamp(
    Math.max(request.houseWallLength, 5.2 * request.scale),
    3.6,
    Math.max(3.6, roomWidth - 0.8),
  );
}

/**
 * A room too shallow for a terrace, a border and something between them is a courtyard: the
 * terrace takes it, and the far room is whatever is left.
 */
export function isCourtyard(scale: number, roomDepth: number): boolean {
  return roomDepth < terraceDepth(scale, roomDepth) + borderDepth(scale) + 1.5;
}

/**
 * The terrace across the door: centred on the door, held inside the room's width, and always
 * at least as wide as the door itself. `v` is measured from the door, so 0 is the door's centre.
 */
export function terraceRect(request: SketchRequest, room: Room): LocalRect {
  const depth = terraceDepth(request.scale, room.uMax - room.uMin);
  const width = terraceWidth(request, room);
  const half = width / 2;

  // Shift the terrace along the wall so it stays inside the room, but never off the door.
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
  const doorHalf = (request.doorWidth ?? 0) / 2;
  v0 = Math.min(v0, -doorHalf);
  v1 = Math.max(v1, doorHalf);

  return { u0: Math.max(room.uMin, 0), u1: Math.max(room.uMin, 0) + depth, v0, v1 };
}

export function rectCentre(rect: LocalRect): LocalPoint {
  return { u: (rect.u0 + rect.u1) / 2, v: (rect.v0 + rect.v1) / 2 };
}

export function rectSize(rect: LocalRect): { width: number; depth: number } {
  return { width: rect.v1 - rect.v0, depth: rect.u1 - rect.u0 };
}
