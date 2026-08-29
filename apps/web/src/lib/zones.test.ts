import { describe, expect, it } from 'vitest';
import type { Point } from '@garden-studio/schema';
import { pointInPolygon, polygonArea } from './boundary-geometry';
import { housePolygon, rectangleHouse, rotateHouse } from './house';
import { computeZones, sortZones, zoneAt, type ZoneId } from './zones';

/** A 20 m x 16 m plot, origin top-left, +y downwards. */
const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

const CENTRED_HOUSE = rectangleHouse({ x: 10, y: 8 }, 8, 6);

function ids(zones: { id: ZoneId }[]): ZoneId[] {
  return zones.map((zone) => zone.id);
}

function zone(zones: ReturnType<typeof computeZones>, id: ZoneId) {
  const found = zones.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`expected a ${id} zone`);
  return found;
}

describe('computeZones', () => {
  it('produces nothing without a house', () => {
    expect(computeZones(PLOT, null)).toEqual([]);
  });

  it('produces nothing without an enclosed plot', () => {
    expect(
      computeZones(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        CENTRED_HOUSE,
      ),
    ).toEqual([]);
  });

  it('splits a centred house into four zones', () => {
    expect(ids(sortZones(computeZones(PLOT, CENTRED_HOUSE)))).toEqual([
      'front',
      'back',
      'left',
      'right',
    ]);
  });

  it('puts the front garden below the house and the back above it', () => {
    // At 0 degrees the house faces +y, which is screen-down.
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    expect(zone(zones, 'front').centroid.y).toBeGreaterThan(8);
    expect(zone(zones, 'back').centroid.y).toBeLessThan(8);
    expect(zone(zones, 'left').centroid.x).toBeLessThan(10);
    expect(zone(zones, 'right').centroid.x).toBeGreaterThan(10);
  });

  it('rotates the zones with the house', () => {
    const zones = computeZones(PLOT, rotateHouse(CENTRED_HOUSE, 90));

    // Clockwise on screen takes "down" round to "left", so the front garden swings from
    // below the house to its left and the back garden lands on its right.
    expect(zone(zones, 'front').centroid.x).toBeLessThan(10);
    expect(zone(zones, 'back').centroid.x).toBeGreaterThan(10);
    expect(zone(zones, 'left').centroid.y).toBeLessThan(8);
    expect(zone(zones, 'right').centroid.y).toBeGreaterThan(8);
  });

  it('never puts a zone label on top of the house', () => {
    const footprint = housePolygon(CENTRED_HOUSE);

    for (const computed of computeZones(PLOT, CENTRED_HOUSE)) {
      expect(pointInPolygon(computed.centroid, footprint)).toBe(false);
    }
  });

  it('drops a zone squeezed out by a house flush against the fence', () => {
    // Pushed hard against the top fence, so there is no garden left behind it.
    const flush = rectangleHouse({ x: 10, y: 3 }, 8, 6);
    const zones = computeZones(PLOT, flush);

    expect(ids(zones)).not.toContain('back');
    expect(ids(zones)).toContain('front');
  });

  it('accounts for the usable area exactly', () => {
    const usable = polygonArea(PLOT) - polygonArea(housePolygon(CENTRED_HOUSE));
    const zoneTotal = computeZones(PLOT, CENTRED_HOUSE).reduce((sum, z) => sum + z.area, 0);

    // Bands tile the plot minus the house with nothing left over, which the old wedges could
    // not do — they met at the house centre and lost its corners out of every zone.
    expect(zoneTotal).toBeCloseTo(usable, 6);
  });

  it('gives the plot corners to the sides, not to the front or back', () => {
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    // The house spans x 6..14, so anything outside that column belongs to a side however far
    // up or down the plot it sits.
    expect(zoneAt({ x: 1, y: 1 }, zones)?.id).toBe('left');
    expect(zoneAt({ x: 19, y: 1 }, zones)?.id).toBe('right');
    expect(zoneAt({ x: 1, y: 15 }, zones)?.id).toBe('left');
    expect(zoneAt({ x: 19, y: 15 }, zones)?.id).toBe('right');
  });

  it('fences the front and back to the width of the house', () => {
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    // 8 m wide house, 5 m of plot in front of it.
    expect(zone(zones, 'front').area).toBeCloseTo(8 * 5, 6);
    expect(zone(zones, 'back').area).toBeCloseTo(8 * 5, 6);
  });

  it('runs the sides the full depth of the plot', () => {
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    // 6 m of plot either side, over the full 16 m depth.
    expect(zone(zones, 'left').area).toBeCloseTo(6 * 16, 6);
    expect(zone(zones, 'right').area).toBeCloseTo(6 * 16, 6);
  });

  it('leaves the bands disjoint', () => {
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    // Sampling the plot on a coarse grid, no point may fall inside two zones at once.
    for (let x = 0.5; x < 20; x += 1) {
      for (let y = 0.5; y < 16; y += 1) {
        const hits = zones.filter((candidate) => pointInPolygon({ x, y }, candidate.polygon));
        expect(hits.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('names each zone once, for the plan and the checklist alike', () => {
    const zones = computeZones(PLOT, CENTRED_HOUSE);

    expect(zone(zones, 'front').label).toBe('Front garden');
    expect(zone(zones, 'back').label).toBe('Back garden');
    expect(zone(zones, 'left').label).toBe('Left side');
    expect(zone(zones, 'right').label).toBe('Right side');
  });

  it('keeps every zone polygon inside the plot', () => {
    for (const computed of computeZones(PLOT, CENTRED_HOUSE)) {
      expect(computed.polygon.every((point) => pointInPolygon(point, PLOT))).toBe(true);
    }
  });

  it('moves the zones with the house rather than reshuffling the labels', () => {
    const shifted = computeZones(PLOT, rectangleHouse({ x: 6, y: 8 }, 8, 6));

    // Sliding left shrinks the left side garden but must not rename it.
    expect(zone(shifted, 'left').area).toBeLessThan(
      zone(computeZones(PLOT, CENTRED_HOUSE), 'left').area,
    );
    expect(zone(shifted, 'left').centroid.x).toBeLessThan(6);
  });
});

describe('zoneAt', () => {
  const ZONES = computeZones(PLOT, CENTRED_HOUSE);

  it('finds the band each point belongs to', () => {
    // At 0 degrees the house faces +y, so front is below it and back above.
    expect(zoneAt({ x: 10, y: 14 }, ZONES)?.id).toBe('front');
    expect(zoneAt({ x: 10, y: 2 }, ZONES)?.id).toBe('back');
    expect(zoneAt({ x: 2, y: 8 }, ZONES)?.id).toBe('left');
    expect(zoneAt({ x: 18, y: 8 }, ZONES)?.id).toBe('right');
  });

  it('agrees with the zone each feature centroid falls in', () => {
    for (const computed of ZONES) {
      expect(zoneAt(computed.centroid, ZONES)?.id).toBe(computed.id);
    }
  });

  it('is null off the plot', () => {
    expect(zoneAt({ x: 40, y: 40 }, ZONES)).toBeNull();
  });

  it('is null on the house itself', () => {
    // The zones are clipped back to the house wall, so its middle belongs to none of them.
    expect(zoneAt({ x: 10, y: 8 }, ZONES)).toBeNull();
  });

  it('is null when no house has been placed', () => {
    expect(zoneAt({ x: 10, y: 8 }, computeZones(PLOT, null))).toBeNull();
  });
});
