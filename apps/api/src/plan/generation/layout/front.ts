import type { Point } from '@garden-studio/schema';
import type { DesignFrame, LocalBox } from './frame.js';
import type { LocalPoint, LocalRect } from './sketch.js';

/**
 * The front garden, which has one job: get you from the street to the door and look kept.
 *
 * A path from the front door to the fence that faces the street, beds along the house wall either
 * side of the door, a low hedge along the street edge either side of where the path meets it, and
 * a tree if there is room. No driveway this pass — that needs a width and a dropped kerb the
 * plan does not capture yet — and no grammar beyond this: a front garden that tries to be a back
 * garden is the mistake this deliberately does not make.
 */
export interface FrontSketch {
  /** The path's centreline in the frame, door to street. */
  path: LocalPoint[];
  /** Beds against the house wall, either side of the door. */
  beds: LocalRect[];
  /** The hedge along the street, either side of the path. */
  hedges: LocalRect[];
  tree: LocalPoint | null;
}

export const FRONT_PATH_WIDTH = 1.2;
const BED_DEPTH = 0.8;
const HEDGE_DEPTH = 0.6;
/** The shallowest front garden worth laying out. Below this it is a doorstep. */
const MIN_FRONT_DEPTH = 2.5;

/**
 * A front garden gets a lawn only when it is a garden: deep enough that the lawn is a panel rather
 * than a verge, and big enough to be worth mowing. Below either it is gravel, whatever the budget —
 * paving would claim a driveway the plan does not capture yet.
 */
export const FRONT_LAWN_FLOOR = { depth: 4, area: 25 };

export function frontWantsLawn(
  depth: number | null,
  area: number,
  lawnAllowed: boolean,
): boolean {
  if (!lawnAllowed || depth === null) return false;
  return depth >= FRONT_LAWN_FLOOR.depth && area >= FRONT_LAWN_FLOOR.area;
}

export function frontGarden(
  frame: DesignFrame,
  room: LocalBox,
  street: [Point, Point] | null,
  doorWidth: number | null,
): FrontSketch | null {
  const depth = room.uMax - Math.max(room.uMin, 0);
  if (depth < MIN_FRONT_DEPTH) return null;

  /*
   * Where the path meets the fence: the foot of the perpendicular from the door onto the street
   * edge when there is one, else straight out to the room's far edge. A street edge that is
   * not the far edge of the front room — a corner plot — gets an L-shaped path to it.
   */
  let end: LocalPoint = { u: room.uMax - 0.05, v: 0 };
  if (street) {
    const foot = frame.toLocal(closestOnSegment(frame.origin, street[0], street[1]));
    if (foot.u > 1) end = { u: Math.min(foot.u, room.uMax) - 0.05, v: foot.v };
  }

  const start: LocalPoint = { u: 0.05, v: 0 };
  const path: LocalPoint[] =
    Math.abs(end.v) < 0.3
      ? [start, { u: end.u, v: 0 }]
      : [start, { u: end.u / 2, v: 0 }, { u: end.u / 2, v: end.v }, end];

  const doorHalf = (doorWidth ?? 0.9) / 2 + 0.3;
  const beds: LocalRect[] = [];
  if (room.vMin + 0.2 < -doorHalf - 0.6) {
    beds.push({ u0: 0, u1: BED_DEPTH, v0: room.vMin + 0.2, v1: -doorHalf });
  }
  if (room.vMax - 0.2 > doorHalf + 0.6) {
    beds.push({ u0: 0, u1: BED_DEPTH, v0: doorHalf, v1: room.vMax - 0.2 });
  }

  // The hedge runs along the far edge of the room, broken where the path goes through.
  const hedgeU0 = end.u - HEDGE_DEPTH - 0.05;
  const hedgeU1 = end.u + 0.05;
  const pathHalf = FRONT_PATH_WIDTH / 2 + 0.3;
  const hedges: LocalRect[] = [];
  if (end.v - pathHalf - (room.vMin + 0.2) > 1.2) {
    hedges.push({ u0: hedgeU0, u1: hedgeU1, v0: room.vMin + 0.2, v1: end.v - pathHalf });
  }
  if (room.vMax - 0.2 - (end.v + pathHalf) > 1.2) {
    hedges.push({ u0: hedgeU0, u1: hedgeU1, v0: end.v + pathHalf, v1: room.vMax - 0.2 });
  }

  const wide = room.vMax - room.vMin;
  const tree: LocalPoint | null =
    depth >= 5 && wide >= 6
      ? { u: depth * 0.55, v: end.v >= 0 ? room.vMin + 1.9 : room.vMax - 1.9 }
      : null;

  return { path, beds, hedges, tree };
}

function closestOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return start;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2),
  );
  return { x: start.x + dx * t, y: start.y + dy * t };
}
