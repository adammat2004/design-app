import {
  clipToHalfPlane,
  directionFromDegrees,
  houseSize,
  polygonArea,
  type ElementCategory,
  type GardenZone,
  type HouseFootprint,
  type MaterialId,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { materialFor, type fillPalette } from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import { MIN_FILL_SIDE } from '../fill-limits.js';
import { circulationFor } from '../room-policy.js';
import { houseBand } from './frame.js';
import { frontWantsLawn } from './front.js';

/**
 * What each zone is *for*, derived every generation and never stored — like the zones themselves.
 *
 * `computeZones` is a fact about geometry: four bands round the house. This is the opinion on
 * top of it: which band is the garden, which is the way in, which is the way past. The base fill
 * stayed the same whatever a zone was for, and that is how the front garden and both side
 * returns came out as turf on every plan — grass all round the house.
 *
 * ```
 *   zone ──┬─ holds the back room's centroid ─────────────────► main
 *          ├─ holds the front room's centroid ────────────────► arrival
 *          ├─ else, w = usable width level with the house:
 *          │      w <  PASSAGE_MAX_WIDTH ─────────────────────► passage
 *          │      w >= PASSAGE_MAX_WIDTH ─────────────────────► secondary
 *          └─ no house, or nothing level with it ─────────────► remote  (today's behaviour)
 * ```
 *
 * **A passage is an accent strip, never a base category.** The side zones own all four corners
 * of the plot, so painting a passage zone's base gravel would paint the back corners gravel —
 * exactly where the shed and the kitchen garden go. `passageStrip` is the zone clipped to the
 * half-plane in front of the house's back wall: the way past the house and the front corner, and
 * nothing behind. The corners behind stay the palette's ground and are designed by the room.
 *
 * A zone the classifier cannot measure — a plot that widens only behind the house, a house flush
 * to one fence, a garden that lies to the side — is `remote`, which is today's behaviour. Never
 * `passage`: gravel on ground nobody measured is worse than turf on ground nobody designed.
 */
export type ZoneRole = 'main' | 'arrival' | 'passage' | 'secondary' | 'remote';

/** A side narrower than this, level with the house, is a way past it rather than a garden. */
export const PASSAGE_MAX_WIDTH = 5.0;

/** The way past the house that a passage's fence bed must leave clear. */
export const PASSAGE_ACCESS_WIDTH = 1.0;

/**
 * The largest a room beside the house may be. A pair of chairs, a table and room to walk round
 * them; beyond that a side room stops being a room and becomes a paved yard, which is what the
 * whole-strip version drew on the L-shaped plot: 8.2 × 6.2 m of decking down one side.
 */
export const SIDE_ROOM_MAX = { width: 4.2, depth: 4.2 };

export interface ZoneRoleContext {
  house: HouseFootprint | null;
  /** The zone the back room's centroid lands in, or `null` when there is no room. */
  roomZoneId: ZoneId | null;
  /** The zone the front room's centroid lands in, or `null` when there is no front. */
  frontZoneId: ZoneId | null;
}

export function zoneRoles(zones: GardenZone[], context: ZoneRoleContext): Map<ZoneId, ZoneRole> {
  const roles = new Map<ZoneId, ZoneRole>();
  for (const zone of zones) {
    if (zone.id === context.roomZoneId) {
      roles.set(zone.id, 'main');
      continue;
    }
    if (zone.id === context.frontZoneId) {
      roles.set(zone.id, 'arrival');
      continue;
    }
    const width = context.house ? usableWidth(zone, context.house) : null;
    if (width === null) {
      roles.set(zone.id, 'remote');
      continue;
    }
    roles.set(zone.id, width < PASSAGE_MAX_WIDTH ? 'passage' : 'secondary');
  }
  return roles;
}

/**
 * How wide a zone is level with the house, measured outward from the house along the zone's own
 * bearing; `null` when nothing of the zone lies level with the house.
 *
 * Measured on the band, not the whole zone, because a side zone runs the full depth of the plot
 * and takes the corners: its bounding box says "26 m" of a strip that is 1.5 m wide beside the
 * house, which is the number that matters.
 */
export function usableWidth(zone: GardenZone, house: HouseFootprint): number | null {
  const band = houseBand(zone.polygon, house);
  if (band.length < 3 || polygonArea(band) < 0.5) return null;

  const outward = zoneOutward(zone.id, house);
  let min = Infinity;
  let max = -Infinity;
  for (const point of band) {
    const along = point.x * outward.x + point.y * outward.y;
    if (along < min) min = along;
    if (along > max) max = along;
  }
  return max - min;
}

/**
 * The part of a zone in front of the house's back wall: beside the house and round to the front
 * corner. What a passage is paved or gravelled over; `null` when there is nothing there.
 */
export function passageStrip(zone: GardenZone, house: HouseFootprint): Point[] | null {
  const { depth } = houseSize(house);
  const back = directionFromDegrees(270 + house.rotation);
  const strip = clipToHalfPlane(
    zone.polygon,
    { x: house.centre.x + back.x * (depth / 2), y: house.centre.y + back.y * (depth / 2) },
    { x: -back.x, y: -back.y },
  );
  return strip.length >= 3 && polygonArea(strip) >= 1 ? strip : null;
}

/**
 * How deep the fence bed in a passage may be: the full border where the passage is wide, less
 * where a bed that deep would block the way past, and nothing at all where even the thinnest
 * survivable bed would. A side return is a way past the house first.
 */
export function passageBorderWidth(usable: number, border: number): number {
  const room = Math.min(border, usable - PASSAGE_ACCESS_WIDTH);
  return room >= MIN_FILL_SIDE ? room : 0;
}

/** The surface a passage is laid in: setts on a formal brief, gravel otherwise. */
export function passageSurface(constraints: DesignConstraints): {
  category: ElementCategory;
  material: MaterialId;
} {
  const { category, material } = circulationFor('utility', constraints);
  return { category, material };
}

/**
 * The largest rectangle that fits in `strip`, aligned to the house, leaving a way past it.
 *
 * A side wide enough to be a room gets one: a lounge deck on a passage's strip, a seating room in
 * a secondary side. `null` when what is left after the access lane is not a room. Measured on the
 * strip's own bounding box in the house's frame, which is exact for the rectangular strips a
 * clipped side zone produces and conservative for anything else — the caller verifies the result
 * with `geometryIsLegal` regardless.
 */
export function sideRoomRect(
  strip: Point[],
  house: HouseFootprint,
  min: { width: number; depth: number },
  max: { width: number; depth: number } = SIDE_ROOM_MAX,
  margin = 0.4,
): { centre: Point; width: number; depth: number; rotation: number } | null {
  if (strip.length < 3) return null;
  const right = directionFromDegrees(house.rotation);
  const back = directionFromDegrees(270 + house.rotation);

  let alongMin = Infinity;
  let alongMax = -Infinity;
  let acrossMin = Infinity;
  let acrossMax = -Infinity;
  for (const point of strip) {
    const along = point.x * right.x + point.y * right.y;
    const across = point.x * back.x + point.y * back.y;
    alongMin = Math.min(alongMin, along);
    alongMax = Math.max(alongMax, along);
    acrossMin = Math.min(acrossMin, across);
    acrossMax = Math.max(acrossMax, across);
  }

  /*
   * `width` runs across the passage, `depth` along it: the lane is taken out of the width, and
   * both are capped — a side room is a place to sit, and a paved rectangle the size of the side
   * of the house is not a room, it is a yard.
   */
  const width = Math.min(max.width, alongMax - alongMin - 2 * margin - PASSAGE_ACCESS_WIDTH);
  const depth = Math.min(max.depth, acrossMax - acrossMin - 2 * margin);
  if (width < min.width || depth < min.depth) return null;

  // Sit the room against the fence, leaving the lane on the house side.
  const alongCentre = alongMin + margin + width / 2;
  const acrossCentre = (acrossMin + acrossMax) / 2;
  return {
    centre: {
      x: right.x * alongCentre + back.x * acrossCentre,
      y: right.y * alongCentre + back.y * acrossCentre,
    },
    width,
    depth,
    rotation: house.rotation,
  };
}

/**
 * The base fill for a zone: the palette's ground, with the one exception the role earns.
 *
 * The front garden is the only zone whose polygon is *exactly* the garden it names — fenced to
 * the house's width, no corners — so it is the one place a whole-zone base can change safely.
 * A front too shallow or too small for a lawn is gravel whatever the budget: paving would claim
 * a driveway the document cannot hold, and a strip of turf in front of a house is a lawn nobody
 * mows. Elsewhere the base is the palette's, exactly as before; the passage strip is laid over it.
 */
export function baseFillFor(
  role: ZoneRole,
  palette: ReturnType<typeof fillPalette>,
  constraints: DesignConstraints,
  index: number,
  front: { depth: number | null; area: number },
): { category: ElementCategory; material: MaterialId } {
  const lawnAllowed = !constraints.forbiddenFill.includes('lawn');

  if (role === 'arrival' && !frontWantsLawn(front.depth, front.area, lawnAllowed)) {
    return { category: 'gravel-mulch', material: materialFor('gravel-mulch', constraints, index) };
  }

  /*
   * The palette's ground cover, never planting. The base is drawn first and everything else on
   * top, so a `planting-bed` base makes "how much of this garden is planting" equal to everything
   * minus the lawn minus the features, whatever the rest of the generator does. Unplanted ground
   * reads as unplanted; a bed is somewhere a bed was actually put.
   */
  const category: ElementCategory =
    palette.base === 'planting-bed' ? (lawnAllowed ? 'lawn' : 'gravel-mulch') : palette.base;
  return { category, material: materialFor(category, constraints, index) };
}

/** The unit vector pointing out of the house into the named zone. */
function zoneOutward(id: ZoneId, house: HouseFootprint): Point {
  const right = directionFromDegrees(house.rotation);
  const back = directionFromDegrees(270 + house.rotation);
  switch (id) {
    case 'right':
      return right;
    case 'left':
      return { x: -right.x, y: -right.y };
    case 'back':
      return back;
    case 'front':
      return { x: -back.x, y: -back.y };
  }
}
