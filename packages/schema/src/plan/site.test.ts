import { describe, expect, it } from 'vitest';
import {
  defaultWalls,
  hasSolarPosition,
  houseSize,
  houseWalls,
  identifyOutline,
  rectangleHouse,
  scaleHouseAbout,
  SiteSectionSchema,
  type HouseFootprint,
} from './site.js';

/**
 * The house's corners and walls carry ids so that things can be *attached* to them — a door
 * recorded as "0.9 m along this wall" has to survive the house being moved, rotated and resized.
 * Nothing attaches to them yet; these are the invariants that make it possible to, and the point
 * of pinning them now is that a later change which quietly renumbers a wall fails here rather than
 * by moving somebody's patio doors.
 */

function withOutline(points: { x: number; y: number }[]): HouseFootprint {
  const outline = identifyOutline(points);
  return { outline, walls: defaultWalls(outline), centre: { x: 10, y: 10 }, rotation: 0 };
}

describe('identifyOutline', () => {
  it('gives every corner an id and moves none of them', () => {
    const points = [
      { x: -4, y: -3 },
      { x: 4, y: -3 },
      { x: 4, y: 3 },
    ];

    expect(identifyOutline(points)).toEqual([
      { id: 'h0', x: -4, y: -3 },
      { id: 'h1', x: 4, y: -3 },
      { id: 'h2', x: 4, y: 3 },
    ]);
  });
});

describe('rectangleHouse', () => {
  it('arrives with corners and walls already identified', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 8, 6);

    expect(house.outline).toHaveLength(4);
    expect(new Set(house.outline.map((vertex) => vertex.id)).size).toBe(4);
    expect(house.walls).toHaveLength(4);
    expect(house.walls.every((wall) => wall.kind === 'external')).toBe(true);
  });
});

describe('houseWalls', () => {
  it('returns what is stored when there is one wall per edge', () => {
    const house = rectangleHouse({ x: 0, y: 0 }, 8, 6);
    const party = {
      ...house,
      walls: house.walls.map((wall, i) => ({
        ...wall,
        kind: i === 1 ? ('party' as const) : wall.kind,
      })),
    };

    expect(houseWalls(party)).toBe(party.walls);
    expect(houseWalls(party)[1]!.kind).toBe('party');
  });

  /*
   * A footprint stored before walls existed has an empty array. Resolving the gap here rather than
   * in every caller is what stops a wall being missing for a corner that exists.
   */
  it('invents an external wall per edge when none are stored', () => {
    const bare = { ...rectangleHouse({ x: 0, y: 0 }, 8, 6), walls: [] };

    expect(houseWalls(bare)).toEqual([
      { id: 'w0', kind: 'external' },
      { id: 'w1', kind: 'external' },
      { id: 'w2', kind: 'external' },
      { id: 'w3', kind: 'external' },
    ]);
  });

  it('fills only the gap when the outline has grown a corner', () => {
    const house = rectangleHouse({ x: 0, y: 0 }, 8, 6);
    const grown: HouseFootprint = {
      ...house,
      outline: [...house.outline, { id: 'h4', x: 0, y: 4 }],
      walls: house.walls.map((wall, i) => ({
        ...wall,
        kind: i === 0 ? ('party' as const) : wall.kind,
      })),
    };

    const resolved = houseWalls(grown);

    expect(resolved).toHaveLength(5);
    // The classification the user already made survives; only the new edge is defaulted.
    expect(resolved[0]!.kind).toBe('party');
    expect(resolved[4]).toEqual({ id: 'w4', kind: 'external' });
  });
});

describe('what the ids have to survive', () => {
  const house = rectangleHouse({ x: 10, y: 8 }, 8, 6);
  const ids = house.outline.map((vertex) => vertex.id);

  it('a move, which only changes the centre', () => {
    const moved = { ...house, centre: { x: 40, y: 25 } };

    expect(moved.outline.map((vertex) => vertex.id)).toEqual(ids);
  });

  it('a rotation, which only changes the angle', () => {
    const rotated = { ...house, rotation: 37 };

    expect(rotated.outline.map((vertex) => vertex.id)).toEqual(ids);
  });

  /*
   * The one that is easy to get wrong: a rescale rewrites every coordinate, and building the new
   * points from `{ x, y }` rather than spreading the old ones drops the ids silently.
   */
  it('a rescale, which rewrites every coordinate', () => {
    const scaled = scaleHouseAbout(house, { x: 0, y: 0 }, 0.1);

    expect(scaled.outline.map((vertex) => vertex.id)).toEqual(ids);
    expect(houseSize(scaled).width).toBeCloseTo(0.8);
  });

  it('and a custom outline keeps them one per corner', () => {
    const custom = withOutline([
      { x: -3, y: -3 },
      { x: 3, y: -3 },
      { x: 3, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: -3, y: 3 },
    ]);

    expect(new Set(custom.outline.map((vertex) => vertex.id)).size).toBe(6);
    expect(houseWalls(custom)).toHaveLength(6);
  });
});

/**
 * Every solar claim in the app is gated on `location`, not on `orientation`.
 *
 * `orientation` can sensibly default, because "north is up" is a real statement about a drawing
 * and it is where the compass has always pointed. A latitude cannot: there is no default that is
 * true of anywhere, and solar altitude is a function of it. A plausible-looking default would put
 * the app in the position of building a design around a fact the user never stated — the same
 * failure `suggestedDoorWall` avoids by offering the inferred patio door rather than applying it.
 */
describe('hasSolarPosition', () => {
  it('is false on a plan nobody has located, which is every existing plan', () => {
    expect(hasSolarPosition(SiteSectionSchema.parse({}))).toBe(false);
  });

  it('stays false when only the orientation has been set', () => {
    const site = SiteSectionSchema.parse({ orientation: 137 });

    expect(site.orientation).toBe(137);
    expect(hasSolarPosition(site)).toBe(false);
  });

  it('is true once a location is stored', () => {
    const site = SiteSectionSchema.parse({ location: { latitude: 53.4, longitude: -2.98 } });

    expect(hasSolarPosition(site)).toBe(true);
  });

  it('rejects coordinates that are not on Earth', () => {
    expect(() => SiteSectionSchema.parse({ location: { latitude: 91, longitude: 0 } })).toThrow();
    expect(() => SiteSectionSchema.parse({ location: { latitude: 0, longitude: 181 } })).toThrow();
  });

  it('defaults the sun to a real instant, and refuses an impossible one', () => {
    expect(SiteSectionSchema.parse({}).sun).toEqual({ dayOfYear: 172, minutes: 900 });

    // 1440 is midnight the following day, which would silently shift the date by one.
    expect(() => SiteSectionSchema.parse({ sun: { dayOfYear: 1, minutes: 1440 } })).toThrow();
    expect(() => SiteSectionSchema.parse({ sun: { dayOfYear: 367, minutes: 0 } })).toThrow();
  });
});
