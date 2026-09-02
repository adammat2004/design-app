import {
  directionFromDegrees,
  edgeLength,
  midpoint,
  pointInPolygon,
  type Point,
} from '../geometry/primitives.js';
import {
  isGardenDoor,
  isGroundWindow,
  OPENINGS_BY_WALL,
  type Opening,
  type OpeningType,
} from './opening.js';
import { housePolygon, houseWalls, type HouseFootprint, type WallKind } from './site.js';
import type { PlanGeometry } from './features.js';

/**
 * Where an opening actually is, in world metres.
 *
 * This is the whole payoff of storing a door as "0.9 m along wall w2" rather than as a pair of
 * coordinates. The position is *derived* every time from the wall it belongs to, so it survives the
 * house being moved, rotated and resized with no update step and no chance of going stale — the
 * same argument `computeZones` makes for not storing zones.
 *
 * Everything here resolves through `housePolygon`, so rotation is applied exactly once, by code
 * that is already tested. A second rotation applied here would be the classic version of this bug:
 * doors that drift off the wall as the house turns.
 *
 * **Every resolver returns `null` rather than guessing.** A wall id that no longer exists, or an
 * opening that overruns a wall a resize has shortened, is a real state the model can reach, and a
 * door placed in mid-air is far worse than a door the caller skips. Callers treat `null` as "this
 * opening does not currently resolve" and carry on.
 */

/** Nothing shorter than this is a wall you can put anything on. */
const MIN_WALL_LENGTH = 1e-6;

/** How far outside the wall to probe when working out which way is out. */
const NORMAL_PROBE = 1e-3;

/** The wall's two ends in world coordinates, in outline order. */
export function wallSegment(house: HouseFootprint, wallId: string): [Point, Point] | null {
  const index = houseWalls(house).findIndex((wall) => wall.id === wallId);
  if (index < 0) return null;

  const ring = housePolygon(house);
  const start = ring[index];
  const end = ring[(index + 1) % ring.length];
  if (!start || !end) return null;

  return edgeLength(start, end) < MIN_WALL_LENGTH ? null : [start, end];
}

/**
 * The opening's own two ends, along its wall.
 *
 * Refuses an opening that does not fit within its wall. A resize shortens walls, and an opening
 * recorded against the old length would otherwise resolve to a door hanging off the end of the
 * building — geometry that looks valid and is nonsense.
 */
export function openingSegment(house: HouseFootprint, opening: Opening): [Point, Point] | null {
  const wall = wallSegment(house, opening.wallId);
  if (!wall) return null;

  const [start, end] = wall;
  const length = edgeLength(start, end);
  const half = opening.width / 2;
  const from = opening.offsetAlongEdge - half;
  const to = opening.offsetAlongEdge + half;

  if (from < -MIN_WALL_LENGTH || to > length + MIN_WALL_LENGTH) return null;

  const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };

  return [
    { x: start.x + unit.x * from, y: start.y + unit.y * from },
    { x: start.x + unit.x * to, y: start.y + unit.y * to },
  ];
}

export function openingCentre(house: HouseFootprint, opening: Opening): Point | null {
  const segment = openingSegment(house, opening);

  return segment ? midpoint(segment[0], segment[1]) : null;
}

/**
 * The unit vector pointing out of the house through this opening.
 *
 * Decided by probing rather than by assuming a winding direction. `rectangleOutline` runs one way
 * and a hand-drawn custom outline may run the other, and an outward normal that is silently inward
 * puts every threshold, view cone and path origin *inside* the building — which would still
 * validate, because nothing checks that a derived direction points somewhere sensible.
 */
export function openingNormal(house: HouseFootprint, opening: Opening): Point | null {
  const wall = wallSegment(house, opening.wallId);
  if (!wall) return null;

  const [start, end] = wall;
  const length = edgeLength(start, end);
  const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };

  // Either normal of a direction; which one is outward is what the probe below decides.
  const candidate = { x: -along.y, y: along.x };
  const mid = midpoint(start, end);
  const probe = {
    x: mid.x + candidate.x * NORMAL_PROBE,
    y: mid.y + candidate.y * NORMAL_PROBE,
  };

  return pointInPolygon(probe, housePolygon(house))
    ? { x: -candidate.x, y: -candidate.y }
    : candidate;
}

/**
 * The keep-clear rectangle in front of a door: as wide as the opening, `depth` metres out.
 *
 * Returned as a `PlanGeometry` rather than a bare ring so it flows straight into `geometryOutline`,
 * `polygonsIntersect` and `polygonToWkt` with no adapter — the placer, the canvas and PostGIS all
 * already speak this.
 *
 * The rectangle's width axis lies along the wall: `rectToPolygon` builds width along +x and then
 * rotates, so the rotation is simply the wall's own bearing.
 */
export function thresholdRect(
  house: HouseFootprint,
  opening: Opening,
  depth: number,
): PlanGeometry | null {
  if (!(depth > 0)) return null;

  const segment = openingSegment(house, opening);
  const normal = openingNormal(house, opening);
  if (!segment || !normal) return null;

  const mid = midpoint(segment[0], segment[1]);
  const along = {
    x: segment[1].x - segment[0].x,
    y: segment[1].y - segment[0].y,
  };

  return {
    kind: 'rect',
    // Pushed half its own depth out, so the rectangle starts at the wall rather than straddling it.
    centre: { x: mid.x + normal.x * (depth / 2), y: mid.y + normal.y * (depth / 2) },
    width: opening.width,
    depth,
    rotation: (Math.atan2(along.y, along.x) * 180) / Math.PI,
  };
}

/* ---------------------------------------------------------------- what fits where */

/** How long a wall is, in metres, or `null` if there is no such wall. */
export function wallLength(house: HouseFootprint, wallId: string): number | null {
  const wall = wallSegment(house, wallId);

  return wall ? edgeLength(wall[0], wall[1]) : null;
}

export function openingsOnWall(house: HouseFootprint, wallId: string): Opening[] {
  return house.openings.filter((opening) => opening.wallId === wallId);
}

/**
 * Whether this sort of wall can hold this sort of opening.
 *
 * A party wall is somebody else's house, so it holds nothing; an attached garage holds a garage
 * door and nothing else. Enforcing it here rather than in the panel means the rule is the same
 * whether an opening arrives from the UI, a preset or a future import.
 */
export function canWallHold(kind: WallKind, type: OpeningType): boolean {
  const allowed = OPENINGS_BY_WALL[kind];

  return allowed === 'all' ? true : (allowed?.includes(type) ?? false);
}

/** The opening's extent along its own wall, as a pair of distances from the wall's start. */
export function openingSpan(opening: Opening): [number, number] {
  const half = opening.width / 2;

  return [opening.offsetAlongEdge - half, opening.offsetAlongEdge + half];
}

/**
 * Whether an opening can sit where it says it does: on a wall that will take it, wholly within
 * that wall, and not through another opening.
 *
 * Two openings cannot share wall — a door and a window in the same hole is not a thing — and
 * `ignoreId` is what lets an opening be tested against its own neighbours while being moved.
 */
export function fitsOnWall(house: HouseFootprint, candidate: Opening): boolean {
  const length = wallLength(house, candidate.wallId);
  if (length === null) return false;

  const wall = houseWalls(house).find((entry) => entry.id === candidate.wallId);
  if (!wall || !canWallHold(wall.kind, candidate.type)) return false;

  const [from, to] = openingSpan(candidate);
  if (from < -MIN_WALL_LENGTH || to > length + MIN_WALL_LENGTH) return false;

  return openingsOnWall(house, candidate.wallId)
    .filter((other) => other.id !== candidate.id)
    .every((other) => {
      const [otherFrom, otherTo] = openingSpan(other);
      // Touching is fine; sharing any width is not.
      return to <= otherFrom + MIN_WALL_LENGTH || from >= otherTo - MIN_WALL_LENGTH;
    });
}

/** The nearest offset that keeps an opening of this width wholly on the wall. */
export function clampOffsetToWall(
  house: HouseFootprint,
  wallId: string,
  width: number,
  desired: number,
): number | null {
  const length = wallLength(house, wallId);
  if (length === null) return null;

  const half = width / 2;
  // A wall too short for the opening has no offset that works; centring is the least wrong answer.
  if (width > length) return length / 2;

  return Math.min(length - half, Math.max(half, desired));
}

/**
 * Somewhere on this wall an opening of this width will actually fit, preferring the centre.
 *
 * Centre first because that is where a person would put a single door, then the gaps between what
 * is already there, left to right. Returns `null` when the wall is full, which the panel reports
 * rather than dropping the request silently.
 */
export function firstFreeOffset(
  house: HouseFootprint,
  wallId: string,
  candidate: Opening,
): number | null {
  const length = wallLength(house, wallId);
  if (length === null || candidate.width > length) return null;

  const half = candidate.width / 2;
  const occupied = openingsOnWall(house, wallId)
    .filter((other) => other.id !== candidate.id)
    .map(openingSpan)
    .sort((a, b) => a[0] - b[0]);

  const offers = [length / 2];
  let cursor = 0;

  // The span's start is deliberately not read. An offer only has to be a *candidate* — the
  // loop below runs every one through `fitsOnWall`, so narrowing the gap here would duplicate
  // a check that already has to happen and could only disagree with it.
  for (const [, to] of occupied) {
    offers.push(cursor + half);
    cursor = Math.max(cursor, to);
  }
  offers.push(cursor + half);

  for (const offer of offers) {
    const at = clampOffsetToWall(house, wallId, candidate.width, offer);
    if (at !== null && fitsOnWall(house, { ...candidate, wallId, offsetAlongEdge: at })) return at;
  }

  return null;
}

/**
 * The wall a patio door most likely belongs on: the one facing the back garden.
 *
 * Derived from the house alone, and from the same convention `computeZones` uses — the back garden
 * is the band off the house's back wall, at bearing 270 before rotation. That makes this agree with
 * the zone the door would open onto without needing the boundary, and it degrades sensibly on a
 * house of any shape. Party and garage walls are skipped; length breaks a tie, because the widest
 * wall facing the garden is where the glazing goes.
 */
export function suggestedDoorWall(house: HouseFootprint): string | null {
  const back = directionFromDegrees(270 + house.rotation);
  let best: { id: string; alignment: number; length: number } | null = null;

  for (const wall of houseWalls(house)) {
    if (!canWallHold(wall.kind, 'patio-door')) continue;

    const segment = wallSegment(house, wall.id);
    if (!segment) continue;

    const length = edgeLength(segment[0], segment[1]);
    const normal = openingNormal(house, {
      id: '',
      wallId: wall.id,
      offsetAlongEdge: length / 2,
      width: Math.min(length, MIN_WALL_LENGTH * 2),
      type: 'patio-door',
      sillHeight: 0,
      floorLevel: 0,
      swing: 'none',
    });
    if (!normal) continue;

    const alignment = normal.x * back.x + normal.y * back.y;
    const better =
      !best ||
      alignment > best.alignment + 1e-9 ||
      (Math.abs(alignment - best.alignment) < 1e-9 && length > best.length);

    if (better) best = { id: wall.id, alignment, length };
  }

  return best?.id ?? null;
}

/* ---------------------------------------------------------------- collections */

/** Every opening on the house, in stored order. `null` house is the common case on step 1. */
export function houseOpenings(house: HouseFootprint | null): Opening[] {
  return house?.openings ?? [];
}

/** The doors a path has to reach — the circulation graph's required nodes. */
export function gardenDoors(house: HouseFootprint | null): Opening[] {
  return houseOpenings(house).filter(isGardenDoor);
}

/** The windows worth projecting a view from. */
export function groundWindows(house: HouseFootprint | null): Opening[] {
  return houseOpenings(house).filter(isGroundWindow);
}

/**
 * The one that most determines the layout: the widest patio door, or failing that any garden door.
 *
 * Widest rather than first, because a set of bifolds is what the terrace belongs in front of and a
 * back door beside them is not. Returns `null` when the house has no openings at all, which is a
 * supported state — every constraint that depends on this is skipped rather than guessed.
 */
export function primaryDoor(house: HouseFootprint | null): Opening | null {
  const doors = gardenDoors(house);
  if (doors.length === 0) return null;

  const patio = doors.filter((door) => door.type === 'patio-door');
  const candidates = patio.length > 0 ? patio : doors;

  return candidates.reduce((widest, door) => (door.width > widest.width ? door : widest));
}
