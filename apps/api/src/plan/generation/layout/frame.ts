import {
  clipToHalfPlane,
  directionFromDegrees,
  housePolygon,
  houseSize,
  midpoint,
  openingCentre,
  openingNormal,
  polygonArea,
  primaryDoorTowards,
  suggestedWallTowards,
  wallNormal,
  wallSegment,
  frontDoor,
  type HouseFootprint,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';

/**
 * The frame a garden is designed in: where you step out, and which way you are facing.
 *
 * A professional plan is drawn from the door outwards. The terrace sits across the doors, the lawn
 * runs away from them, the far room is at the end of that view, and everything is aligned to the
 * wall the doors are in — not to the screen, and not to the plot. So the grammar works in *local*
 * coordinates: `u` is metres out from the door along its outward normal, `v` is metres along the
 * wall (positive to the right when facing out). `toWorld` is the only place that turns back into
 * plan metres, and it is what every placed rectangle's rotation comes from.
 *
 * Nothing here is stored. The frame is derived from the house every generation, like zones.
 */
export interface DesignFrame {
  /** The door's centre on the wall line, or the wall's midpoint when there is no door. */
  origin: Point;
  /** Unit vector out of the house, into the garden. */
  axis: Point;
  /** Unit vector along the wall, to the right when looking out. */
  cross: Point;
  /** Degrees clockwise: the rotation a rect aligned to this wall carries. */
  wallBearing: number;
  wallLength: number;
  doorWidth: number | null;
  source: 'door' | 'wall';
  toWorld(u: number, v: number): Point;
  toLocal(point: Point): { u: number; v: number };
}

function makeFrame(
  origin: Point,
  axis: Point,
  wallLength: number,
  doorWidth: number | null,
  source: 'door' | 'wall',
): DesignFrame {
  // Cross is the axis turned a quarter clockwise in this y-down frame: facing out, v runs right.
  const cross = { x: -axis.y, y: axis.x };
  const wallBearing = (Math.atan2(cross.y, cross.x) * 180) / Math.PI;

  return {
    origin,
    axis,
    cross,
    wallBearing,
    wallLength,
    doorWidth,
    source,
    toWorld: (u, v) => ({
      x: origin.x + axis.x * u + cross.x * v,
      y: origin.y + axis.y * u + cross.y * v,
    }),
    toLocal: (point) => {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      return { u: dx * axis.x + dy * axis.y, v: dx * cross.x + dy * cross.y };
    },
  };
}

/**
 * The frame off the back of the house: the widest patio door facing the garden, else the wall
 * facing that way. `garden` is the direction the garden lies — away from the street once the
 * user has said where that is (`gardenDirection`), else the house's own back — so a house drawn
 * "upside down" on the plot still gets its terrace on the garden side. `null` only when the
 * house has no wall facing that way at all.
 */
export function backFrame(house: HouseFootprint, garden?: Point): DesignFrame | null {
  return frameTowards(house, garden ?? directionFromDegrees(270 + house.rotation));
}

/** The same, off the front: the front door, else the wall facing the street. */
export function frontFrame(house: HouseFootprint, street?: Point): DesignFrame | null {
  const door = frontDoor(house, street);
  if (door) {
    const centre = openingCentre(house, door);
    const normal = openingNormal(house, door);
    const wall = wallSegment(house, door.wallId);
    if (centre && normal && wall) {
      return makeFrame(
        centre,
        normal,
        Math.hypot(wall[1].x - wall[0].x, wall[1].y - wall[0].y),
        door.width,
        'door',
      );
    }
  }
  return frameTowards(house, street ?? directionFromDegrees(90 + house.rotation));
}

function frameTowards(house: HouseFootprint, facing: Point): DesignFrame | null {
  const door = primaryDoorTowards(house, facing);
  if (door) {
    const centre = openingCentre(house, door);
    const normal = openingNormal(house, door);
    const wall = wallSegment(house, door.wallId);
    if (centre && normal && wall) {
      return makeFrame(
        centre,
        normal,
        Math.hypot(wall[1].x - wall[0].x, wall[1].y - wall[0].y),
        door.width,
        'door',
      );
    }
  }

  const wallId = suggestedWallTowards(house, facing, 'patio-door');
  if (!wallId) return null;
  const wall = wallSegment(house, wallId);
  const normal = wallNormal(house, wallId);
  if (!wall || !normal) return null;

  return makeFrame(
    midpoint(wall[0], wall[1]),
    normal,
    Math.hypot(wall[1].x - wall[0].x, wall[1].y - wall[0].y),
    null,
    'wall',
  );
}

/* ---------------------------------------------------------------- rooms */

/** The smallest room worth designing, in square metres. Below this the frame gives up. */
export const MIN_ROOM_AREA = 4;

/**
 * The garden behind the door wall, as one polygon.
 *
 * `computeZones` fences the back band to the house's width and gives the corners to the sides, so
 * a lawn drawn in the back *zone* alone leaves two stripes either side of it with their own
 * ground — three strips, not a garden. The room is the plot clipped to the half-plane behind the
 * wall, then trimmed by the same cross fences the zones use for any side that is **not** in
 * scope, so an un-ticked side return is left alone. Zones themselves are untouched: every element
 * still gets its zone by where its centroid lands, and every zone still gets its base fill.
 */
export function gardenRoom(
  boundary: Point[],
  house: HouseFootprint,
  frame: DesignFrame,
  scope: ZoneId[],
): Point[] {
  if (boundary.length < 3) return [];

  // The half-plane beyond the door wall: the house and everything behind it are already out.
  let room = clipToHalfPlane(boundary, frame.origin, frame.axis);
  room = withoutSidesOutOfScope(room, house, scope);

  return polygonArea(room) < MIN_ROOM_AREA ? [] : room;
}

function withoutSidesOutOfScope(polygon: Point[], house: HouseFootprint, scope: ZoneId[]): Point[] {
  const { width } = houseSize(house);
  const right = directionFromDegrees(house.rotation);
  const half = width / 2;
  let room = polygon;

  // The zone bands' own cross fences, applied only where the side is not being designed.
  if (!scope.includes('right')) {
    room = clipToHalfPlane(
      room,
      { x: house.centre.x + right.x * half, y: house.centre.y + right.y * half },
      { x: -right.x, y: -right.y },
    );
  }
  if (!scope.includes('left')) {
    room = clipToHalfPlane(
      room,
      { x: house.centre.x - right.x * half, y: house.centre.y - right.y * half },
      right,
    );
  }

  return room;
}

/** The side return beside the house on one side: the part of a side zone level with the house. */
export function sideReturn(
  boundary: Point[],
  house: HouseFootprint,
  side: 'left' | 'right',
): Point[] {
  if (boundary.length < 3) return [];
  const { width, depth } = houseSize(house);
  const right = directionFromDegrees(house.rotation);
  const back = directionFromDegrees(270 + house.rotation);
  const sign = side === 'right' ? 1 : -1;

  let strip = clipToHalfPlane(
    boundary,
    {
      x: house.centre.x + right.x * sign * (width / 2),
      y: house.centre.y + right.y * sign * (width / 2),
    },
    { x: right.x * sign, y: right.y * sign },
  );
  // Level with the house: between its front wall and its back wall.
  strip = clipToHalfPlane(
    strip,
    { x: house.centre.x + back.x * (depth / 2), y: house.centre.y + back.y * (depth / 2) },
    { x: -back.x, y: -back.y },
  );
  strip = clipToHalfPlane(
    strip,
    { x: house.centre.x - back.x * (depth / 2), y: house.centre.y - back.y * (depth / 2) },
    back,
  );
  return polygonArea(strip) < 0.5 ? [] : strip;
}

/* ---------------------------------------------------------------- local extents */

export interface LocalBox {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** The room's own outline in local coordinates, for containment checks in the frame. */
  polygon: { u: number; v: number }[];
}

/** The room's extent in the frame. `uMin` is normally 0: the room starts at the wall. */
export function localBox(room: Point[], frame: DesignFrame): LocalBox {
  const polygon = room.map((point) => frame.toLocal(point));
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const { u, v } of polygon) {
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  return { uMin, uMax, vMin, vMax, polygon };
}

/** The house's outline in the frame, for the sketch to keep the terrace off the returns. */
export function localHouse(house: HouseFootprint, frame: DesignFrame): { u: number; v: number }[] {
  return housePolygon(house).map((point) => frame.toLocal(point));
}
