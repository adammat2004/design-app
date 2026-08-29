import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonsIntersect, type Point } from '../geometry/primitives.js';
import { geometryOutline } from './features.js';
import { isGardenDoor, THRESHOLD_DEPTH, type Opening } from './opening.js';
import {
  canWallHold,
  clampOffsetToWall,
  firstFreeOffset,
  fitsOnWall,
  gardenDoors,
  groundWindows,
  openingCentre,
  openingNormal,
  openingSegment,
  primaryDoor,
  suggestedDoorWall,
  thresholdRect,
  wallSegment,
} from './openings.js';
import {
  houseWalls,
  housePolygon,
  houseSize,
  identifyOutline,
  defaultWalls,
  rectangleHouse,
  type HouseFootprint,
  type HouseVertex,
} from './site.js';

/**
 * The same thing the editor's `resizeHouse` does — scale the local outline to a new bounding box,
 * ids intact. Written here rather than imported because resizing is an editor gesture and lives in
 * the web app; what this file needs is only a house whose walls have genuinely changed length.
 */
function resizeOutlineTo(outline: HouseVertex[], width: number, depth: number): HouseVertex[] {
  const current = houseSize({
    outline,
    walls: [],
    openings: [],
    centre: { x: 0, y: 0 },
    rotation: 0,
  });
  const scaleX = width / current.width;
  const scaleY = depth / current.depth;

  return outline.map((vertex) => ({ ...vertex, x: vertex.x * scaleX, y: vertex.y * scaleY }));
}

/**
 * The point of storing a door as "0.9 m along wall w2" is that its position is derived rather than
 * remembered. These are the tests that make that claim true rather than merely intended — a door
 * has to stay on its wall through a move, a rotation and a resize, and has to refuse to resolve
 * rather than land in mid-air when the wall it belonged to is gone.
 */

/** An 8 x 6 m house centred at (10, 8), walls w0..w3 running clockwise from the top-left. */
function house(overrides: Partial<HouseFootprint> = {}): HouseFootprint {
  return { ...rectangleHouse({ x: 10, y: 8 }, 8, 6), ...overrides };
}

function door(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'o1',
    wallId: 'w2',
    offsetAlongEdge: 4,
    width: 2.4,
    type: 'patio-door',
    sillHeight: 0,
    floorLevel: 0,
    swing: 'none',
    ...overrides,
  };
}

/** Distance from a point to the nearest corner of the house, for the invariance checks. */
function relativeTo(at: Point, ring: Point[]): number[] {
  return ring.map((corner) => Number(Math.hypot(at.x - corner.x, at.y - corner.y).toFixed(6)));
}

describe('wallSegment', () => {
  it('finds a wall by id, in world coordinates', () => {
    const built = house();
    const segment = wallSegment(built, houseWalls(built)[0]!.id)!;

    // Wall w0 is the first edge of the outline, in world space.
    expect(segment[0]).toEqual(housePolygon(built)[0]);
    expect(segment[1]).toEqual(housePolygon(built)[1]);
  });

  it('has no answer for a wall that is not there', () => {
    expect(wallSegment(house(), 'w99')).toBeNull();
  });
});

describe('openingSegment', () => {
  it('sits centred on its offset along the wall', () => {
    const built = house();
    const segment = openingSegment(built, door({ wallId: 'w0', offsetAlongEdge: 2, width: 2 }))!;
    const wall = wallSegment(built, 'w0')!;

    // 1 m and 3 m along an 8 m wall that runs left to right at the top of the house.
    expect(segment[0].x).toBeCloseTo(wall[0].x + 1);
    expect(segment[1].x).toBeCloseTo(wall[0].x + 3);
    expect(segment[0].y).toBeCloseTo(wall[0].y);
  });

  it('is exactly as wide as the opening', () => {
    const segment = openingSegment(house(), door({ wallId: 'w0', width: 2.4 }))!;

    expect(Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y)).toBeCloseTo(2.4);
  });

  it('fits flush at either end of the wall', () => {
    const built = house();

    expect(
      openingSegment(built, door({ wallId: 'w0', offsetAlongEdge: 1.2, width: 2.4 })),
    ).not.toBeNull();
    expect(
      openingSegment(built, door({ wallId: 'w0', offsetAlongEdge: 6.8, width: 2.4 })),
    ).not.toBeNull();
  });

  /*
   * The state a resize can create, and the reason every resolver returns null rather than a best
   * guess: a door recorded against an 8 m wall, on a wall that is now 3 m long, is not a door
   * hanging off the end of the building — it is an opening that does not currently resolve.
   */
  it('refuses to resolve when it overruns its wall', () => {
    const built = house();

    expect(
      openingSegment(built, door({ wallId: 'w0', offsetAlongEdge: 7.5, width: 2.4 })),
    ).toBeNull();
    expect(
      openingSegment(built, door({ wallId: 'w0', offsetAlongEdge: 0.5, width: 2.4 })),
    ).toBeNull();
  });

  it('refuses when the wall it names has gone', () => {
    expect(openingSegment(house(), door({ wallId: 'demolished' }))).toBeNull();
  });
});

describe('what an opening has to survive', () => {
  const patio = door({ wallId: 'w2', offsetAlongEdge: 4, width: 2.4 });

  /*
   * Position is derived from the wall every time, so these are not "the code remembers to update
   * it" — there is nothing to update. What they guard against is a resolver that applies rotation
   * a second time, which is the classic version of this bug: doors that drift off the wall as the
   * house turns.
   */
  it('a move: it travels with the house and stays put relative to its corners', () => {
    const before = house();
    const after = house({ centre: { x: 40, y: 25 } });

    const from = openingCentre(before, patio)!;
    const to = openingCentre(after, patio)!;

    expect(to.x).toBeCloseTo(from.x + 30);
    expect(to.y).toBeCloseTo(from.y + 17);
    expect(relativeTo(to, housePolygon(after))).toEqual(relativeTo(from, housePolygon(before)));
  });

  it('a rotation: it stays on the same wall, at the same place along it', () => {
    const before = house();
    const after = house({ rotation: 37 });

    const from = openingCentre(before, patio)!;
    const to = openingCentre(after, patio)!;

    // Its distance to each corner is unchanged, which is what "still on the same wall" means.
    expect(relativeTo(to, housePolygon(after))).toEqual(relativeTo(from, housePolygon(before)));
  });

  it('a resize: it stays on the wall, and the wall is where it is measured from', () => {
    const before = house();
    const after = house({ outline: resizeOutlineTo(before.outline, 12, 9) });

    const centre = openingCentre(after, patio)!;
    const wall = wallSegment(after, 'w2')!;

    // Still 4 m along its own wall, which is now a different wall.
    expect(Math.hypot(centre.x - wall[0].x, centre.y - wall[0].y)).toBeCloseTo(4);
  });

  it('a resize that shortens the wall under it: it stops resolving rather than lying', () => {
    const before = house();
    const shrunk = house({ outline: resizeOutlineTo(before.outline, 3, 6) });

    expect(openingSegment(before, patio)).not.toBeNull();
    expect(openingSegment(shrunk, patio)).toBeNull();
  });
});

describe('openingNormal', () => {
  /*
   * Decided by probing rather than by assuming a winding direction. An inward "outward" normal
   * would put every threshold, view cone and path origin inside the building, and nothing
   * downstream checks that a derived direction points somewhere sensible.
   */
  it('points out of the house, on every wall', () => {
    const built = house();
    const ring = housePolygon(built);

    for (const wall of houseWalls(built)) {
      const opening = door({ wallId: wall.id, offsetAlongEdge: 1.5, width: 1 });
      const normal = openingNormal(built, opening)!;
      const centre = openingCentre(built, opening)!;

      expect(
        pointInPolygon({ x: centre.x + normal.x * 0.5, y: centre.y + normal.y * 0.5 }, ring),
      ).toBe(false);
      expect(
        pointInPolygon({ x: centre.x - normal.x * 0.5, y: centre.y - normal.y * 0.5 }, ring),
      ).toBe(true);
    }
  });

  it('points out of a house whose outline was drawn the other way round', () => {
    const clockwise = house();
    // A hand-drawn custom outline can wind either way; the normal must not depend on which.
    const anticlockwise = house({ outline: [...clockwise.outline].reverse() });
    const ring = housePolygon(anticlockwise);
    const opening = door({ wallId: 'w0', offsetAlongEdge: 2, width: 1 });

    const normal = openingNormal(anticlockwise, opening)!;
    const centre = openingCentre(anticlockwise, opening)!;

    expect(
      pointInPolygon({ x: centre.x + normal.x * 0.5, y: centre.y + normal.y * 0.5 }, ring),
    ).toBe(false);
  });

  it('is a unit vector', () => {
    const normal = openingNormal(house(), door())!;

    expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1);
  });

  it('turns with the house', () => {
    const straight = openingNormal(house(), door())!;
    const turned = openingNormal(house({ rotation: 90 }), door())!;

    expect(turned.x).toBeCloseTo(-straight.y);
    expect(turned.y).toBeCloseTo(straight.x);
  });
});

describe('thresholdRect', () => {
  it('is as wide as the door and as deep as it is asked to be', () => {
    const rect = thresholdRect(house(), door({ width: 2.4 }), THRESHOLD_DEPTH)!;

    expect(rect.kind).toBe('rect');
    if (rect.kind !== 'rect') return;
    expect(rect.width).toBeCloseTo(2.4);
    expect(rect.depth).toBeCloseTo(THRESHOLD_DEPTH);
  });

  /*
   * The whole point: it is the ground in front of the door, not a band straddling the wall. Half of
   * it inside the house would be permanently unusable and would fight the house-clearance rule.
   */
  it('lies outside the house, touching the wall rather than crossing it', () => {
    const built = house();
    const rect = thresholdRect(built, door(), THRESHOLD_DEPTH)!;
    const ring = housePolygon(built);

    expect(polygonsIntersect(geometryOutline(rect), ring)).toBe(false);

    // And it really is against the wall: its near edge shares the door's own position.
    const centre = openingCentre(built, door())!;
    const outline = geometryOutline(rect);
    const nearest = Math.min(...outline.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y)));
    expect(nearest).toBeCloseTo(1.2);
  });

  it('stays outside the house when the house is rotated', () => {
    const built = house({ rotation: 37 });
    const rect = thresholdRect(built, door(), THRESHOLD_DEPTH)!;

    expect(polygonsIntersect(geometryOutline(rect), housePolygon(built))).toBe(false);
  });

  it('has nothing to describe for an opening that does not resolve, or no depth', () => {
    expect(thresholdRect(house(), door({ wallId: 'gone' }), THRESHOLD_DEPTH)).toBeNull();
    expect(thresholdRect(house(), door(), 0)).toBeNull();
  });
});

describe('reading the openings off a house', () => {
  const patio = door({ id: 'a', type: 'patio-door', width: 2.4, wallId: 'w2' });
  const back = door({ id: 'b', type: 'back-door', width: 0.9, wallId: 'w1' });
  const window = door({ id: 'c', type: 'window', width: 1.2, wallId: 'w0', sillHeight: 0.9 });
  const upstairs = door({ id: 'd', type: 'upper-window', width: 1.2, wallId: 'w0', floorLevel: 1 });
  const bifold = door({
    id: 'e',
    type: 'patio-door',
    width: 3.6,
    wallId: 'w2',
    offsetAlongEdge: 4,
  });

  const built = house({ openings: [patio, back, window, upstairs] });

  it('counts only the doors you can walk out of', () => {
    expect(gardenDoors(built).map((o) => o.id)).toEqual(['a', 'b']);
    expect(gardenDoors(built).every(isGardenDoor)).toBe(true);
  });

  it('counts only ground-floor windows as views', () => {
    expect(groundWindows(built).map((o) => o.id)).toEqual(['c']);
  });

  it('prefers the widest patio door as the one that determines the layout', () => {
    const many = house({ openings: [back, patio, bifold] });

    expect(primaryDoor(many)?.id).toBe('e');
  });

  it('falls back to any garden door when there is no patio door', () => {
    expect(primaryDoor(house({ openings: [back, window] }))?.id).toBe('b');
  });

  /*
   * A house with no openings is a supported state, not an error: every plan stored before openings
   * existed is one. Constraints that depend on a door are skipped, never guessed.
   */
  it('has no primary door on a house with none, or no house at all', () => {
    expect(primaryDoor(house())).toBeNull();
    expect(primaryDoor(house({ openings: [upstairs] }))).toBeNull();
    expect(primaryDoor(null)).toBeNull();
    expect(gardenDoors(null)).toEqual([]);
  });
});

describe('what a wall will take', () => {
  it('lets an external wall hold anything', () => {
    expect(canWallHold('external', 'patio-door')).toBe(true);
    expect(canWallHold('external', 'window')).toBe(true);
  });

  /*
   * A party wall is the neighbour's house. A door on one would have the generator design a path to
   * a doorway into somebody else's kitchen, which is why this is a rule rather than a warning.
   */
  it('lets a party wall hold nothing', () => {
    expect(canWallHold('party', 'patio-door')).toBe(false);
    expect(canWallHold('party', 'window')).toBe(false);
  });

  it('lets an attached garage hold a garage door and nothing else', () => {
    expect(canWallHold('garage', 'garage-door')).toBe(true);
    expect(canWallHold('garage', 'patio-door')).toBe(false);
  });
});

describe('fitsOnWall', () => {
  it('accepts an opening wholly on an external wall', () => {
    expect(fitsOnWall(house(), door({ wallId: 'w0', offsetAlongEdge: 4, width: 2.4 }))).toBe(true);
  });

  it('refuses one that hangs off the end', () => {
    expect(fitsOnWall(house(), door({ wallId: 'w0', offsetAlongEdge: 7.5, width: 2.4 }))).toBe(
      false,
    );
  });

  it('refuses one the wall will not take', () => {
    const built = house();
    const party = house({
      walls: houseWalls(built).map((wall) =>
        wall.id === 'w0' ? { ...wall, kind: 'party' } : wall,
      ),
    });

    expect(fitsOnWall(party, door({ wallId: 'w0', offsetAlongEdge: 4 }))).toBe(false);
  });

  /* Two openings cannot share wall: a door and a window in the same hole is not a thing. */
  it('refuses one that runs through another', () => {
    const existing = door({ id: 'a', wallId: 'w0', offsetAlongEdge: 4, width: 2.4 });
    const built = house({ openings: [existing] });

    expect(fitsOnWall(built, door({ id: 'b', wallId: 'w0', offsetAlongEdge: 5, width: 2 }))).toBe(
      false,
    );
    // Flush against it is fine — 2.8..5.2 then 5.2..6.2.
    expect(fitsOnWall(built, door({ id: 'b', wallId: 'w0', offsetAlongEdge: 5.7, width: 1 }))).toBe(
      true,
    );
  });

  it('lets an opening be tested against its own neighbours while it moves', () => {
    const existing = door({ id: 'a', wallId: 'w0', offsetAlongEdge: 4, width: 2.4 });
    const built = house({ openings: [existing] });

    // Moving 'a' a little must not clash with 'a'.
    expect(fitsOnWall(built, { ...existing, offsetAlongEdge: 4.5 })).toBe(true);
  });
});

describe('clampOffsetToWall', () => {
  it('keeps an opening wholly on the wall', () => {
    const built = house();

    expect(clampOffsetToWall(built, 'w0', 2.4, 0)).toBeCloseTo(1.2);
    expect(clampOffsetToWall(built, 'w0', 2.4, 99)).toBeCloseTo(6.8);
    expect(clampOffsetToWall(built, 'w0', 2.4, 4)).toBeCloseTo(4);
  });

  it('centres an opening wider than the wall rather than returning nonsense', () => {
    expect(clampOffsetToWall(house(), 'w1', 12, 0)).toBeCloseTo(3);
  });

  it('has no answer for a wall that is not there', () => {
    expect(clampOffsetToWall(house(), 'w99', 1, 1)).toBeNull();
  });
});

describe('firstFreeOffset', () => {
  it('prefers the middle of an empty wall, which is where a person would put one', () => {
    expect(firstFreeOffset(house(), 'w0', door({ width: 2.4 }))).toBeCloseTo(4);
  });

  it('finds a gap beside what is already there', () => {
    const built = house({
      openings: [door({ id: 'a', wallId: 'w0', offsetAlongEdge: 4, width: 2.4 })],
    });
    const at = firstFreeOffset(built, 'w0', door({ id: 'b', width: 1.2 }))!;

    expect(at).not.toBeNull();
    expect(
      fitsOnWall(built, door({ id: 'b', wallId: 'w0', offsetAlongEdge: at, width: 1.2 })),
    ).toBe(true);
  });

  it('says so when the wall is full rather than dropping the request silently', () => {
    const full = house({
      openings: [door({ id: 'a', wallId: 'w1', offsetAlongEdge: 3, width: 5.8 })],
    });

    expect(firstFreeOffset(full, 'w1', door({ id: 'b', width: 2.4 }))).toBeNull();
  });

  it('says so when the opening is wider than the wall', () => {
    expect(firstFreeOffset(house(), 'w1', door({ width: 12 }))).toBeNull();
  });
});

describe('suggestedDoorWall', () => {
  /*
   * The back garden is the band off the house's back wall — bearing 270 before rotation, which is
   * how `computeZones` defines it. Deriving the suggestion the same way is what makes the door
   * agree with the zone it opens onto, without needing the boundary.
   */
  it('picks the wall facing the back garden', () => {
    const built = house();
    const suggested = suggestedDoorWall(built)!;
    const normal = openingNormal(built, door({ wallId: suggested }))!;

    // At rotation 0 the back garden is at -y, which is up the screen.
    expect(normal.y).toBeLessThan(0);
  });

  it('turns with the house', () => {
    const built = house({ rotation: 90 });
    const suggested = suggestedDoorWall(built)!;
    const normal = openingNormal(built, door({ wallId: suggested, offsetAlongEdge: 3, width: 1 }))!;

    expect(normal.x).toBeGreaterThan(0);
  });

  it('will not suggest a wall that cannot hold a door', () => {
    const built = house();
    const backWall = suggestedDoorWall(built)!;
    const walled = house({
      walls: houseWalls(built).map((wall) =>
        wall.id === backWall ? { ...wall, kind: 'party' } : wall,
      ),
    });

    expect(suggestedDoorWall(walled)).not.toBe(backWall);
  });

  it('has nothing to suggest when no wall can hold a door', () => {
    const built = house();
    const allParty = house({
      walls: houseWalls(built).map((wall) => ({ ...wall, kind: 'party' as const })),
    });

    expect(suggestedDoorWall(allParty)).toBeNull();
  });
});

describe('a custom outline', () => {
  it('carries openings on its walls like any other', () => {
    const outline = identifyOutline([
      { x: -3, y: -3 },
      { x: 3, y: -3 },
      { x: 3, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: -3, y: 3 },
    ]);
    const built: HouseFootprint = {
      outline,
      walls: defaultWalls(outline),
      openings: [],
      centre: { x: 10, y: 10 },
      rotation: 0,
    };

    const opening = door({ wallId: 'w5', offsetAlongEdge: 3, width: 1 });
    const normal = openingNormal(built, opening)!;
    const centre = openingCentre(built, opening)!;

    expect(centre).not.toBeNull();
    expect(
      pointInPolygon(
        { x: centre.x + normal.x * 0.5, y: centre.y + normal.y * 0.5 },
        housePolygon(built),
      ),
    ).toBe(false);
  });
});
