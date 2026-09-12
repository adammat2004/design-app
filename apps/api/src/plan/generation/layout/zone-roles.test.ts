import { describe, expect, it } from 'vitest';
import {
  computeZones,
  pointInPolygon,
  polygonArea,
  rectangleHouse,
  rectanglePlotOutline,
  type GardenZone,
  type HouseFootprint,
  type Point,
} from '@garden-studio/schema';
import { fillPalette } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { ARCHETYPES } from '../archetypes.js';
import {
  baseFillFor,
  PASSAGE_MAX_WIDTH,
  passageBorderWidth,
  passageStrip,
  usableWidth,
  zoneRoles,
} from './zone-roles.js';

/*
 * The classifier is pure geometry over `computeZones`, so every case here is a plot, a house and
 * the roles that come out — no database, no brief beyond what `resolveConstraints` needs.
 */

const rectangle = (width: number, depth: number): Point[] => rectanglePlotOutline({ width, depth });

function zonesOf(plot: Point[], house: HouseFootprint): GardenZone[] {
  return computeZones(plot, house);
}

function byId(zones: GardenZone[], id: GardenZone['id']): GardenZone {
  return zones.find((zone) => zone.id === id)!;
}

/** Suburban: 18 × 26, a 9 × 7 house facing up at y = 6.5, so the back garden is the 16 m below. */
const suburbanPlot = rectangle(18, 26);
const suburbanHouse: HouseFootprint = { ...rectangleHouse({ x: 9, y: 6.5 }, 9, 7), rotation: 180 };

describe('zoneRoles', () => {
  it('names the room main, the front arrival, and 4.5 m sides passages', () => {
    const zones = zonesOf(suburbanPlot, suburbanHouse);
    const roles = zoneRoles(zones, { house: suburbanHouse, roomZoneId: 'back', frontZoneId: 'front' });
    expect(roles.get('back')).toBe('main');
    expect(roles.get('front')).toBe('arrival');
    expect(roles.get('left')).toBe('passage');
    expect(roles.get('right')).toBe('passage');
    expect(usableWidth(byId(zones, 'left'), suburbanHouse)).toBeCloseTo(4.5);
  });

  it('calls a 6 m side secondary: wide enough to be a garden of its own', () => {
    // The layout test's plan: 20 × 16, an 8 × 6 house at (10, 10), 6 m either side.
    const house = rectangleHouse({ x: 10, y: 10 }, 8, 6);
    const zones = zonesOf(rectangle(20, 16), house);
    const roles = zoneRoles(zones, { house, roomZoneId: 'back', frontZoneId: 'front' });
    expect(roles.get('left')).toBe('secondary');
    expect(roles.get('right')).toBe('secondary');
    expect(usableWidth(byId(zones, 'right'), house)).toBeCloseTo(6);
    expect(PASSAGE_MAX_WIDTH).toBe(5);
  });

  it('measures the band level with the house, not the whole zone', () => {
    // A side zone runs the full 26 m depth; what matters is the 4.5 m beside the house.
    const zones = zonesOf(suburbanPlot, suburbanHouse);
    const left = byId(zones, 'left');
    expect(polygonArea(left.polygon)).toBeGreaterThan(100);
    expect(usableWidth(left, suburbanHouse)).toBeCloseTo(4.5);
  });

  it('turns with the house', () => {
    const house: HouseFootprint = { ...rectangleHouse({ x: 6.5, y: 9 }, 9, 7), rotation: 90 };
    const zones = zonesOf(rectangle(26, 18), house);
    const roles = zoneRoles(zones, { house, roomZoneId: 'back', frontZoneId: 'front' });
    expect(roles.get('left')).toBe('passage');
    expect(roles.get('right')).toBe('passage');
    expect(usableWidth(byId(zones, 'left'), house)).toBeCloseTo(4.5);
  });

  it('drops a side the house is flush against, and reads the other side alone', () => {
    const house = rectangleHouse({ x: 4, y: 10 }, 8, 6);
    const zones = zonesOf(rectangle(20, 16), house);
    expect(zones.map((zone) => zone.id)).not.toContain('left');
    const roles = zoneRoles(zones, { house, roomZoneId: 'back', frontZoneId: 'front' });
    expect(roles.get('right')).toBe('secondary');
  });

  it('calls a zone with nothing level with the house remote, never passage', () => {
    // An L: 8 m wide beside the house, opening to 20 m only behind it (y < 8).
    const plot: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 16 },
      { x: 0, y: 16 },
    ];
    const house = rectangleHouse({ x: 4, y: 11 }, 8, 6);
    const zones = zonesOf(plot, house);
    const roles = zoneRoles(zones, { house, roomZoneId: 'back', frontZoneId: 'front' });
    expect(zones.map((zone) => zone.id)).toContain('right');
    expect(usableWidth(byId(zones, 'right'), house)).toBeNull();
    expect(roles.get('right')).toBe('remote');
  });

  it('is remote everywhere without a house', () => {
    const roles = zoneRoles(zonesOf(suburbanPlot, suburbanHouse), {
      house: null,
      roomZoneId: null,
      frontZoneId: null,
    });
    expect([...roles.values()].every((role) => role === 'remote')).toBe(true);
  });
});

describe('passageStrip', () => {
  it('covers the band beside the house and the front corner, never the back corner', () => {
    const zones = zonesOf(suburbanPlot, suburbanHouse);
    // Rotated 180°, the zone named `right` is the strip on the screen's left (x < 4.5).
    const strip = passageStrip(byId(zones, 'right'), suburbanHouse)!;
    expect(strip).not.toBeNull();
    // The house's back wall is at y = 10; the strip is everything in the zone in front of it.
    expect(polygonArea(strip)).toBeCloseTo(4.5 * 10);
    expect(pointInPolygon({ x: 2, y: 5 }, strip)).toBe(true); // beside the house
    expect(pointInPolygon({ x: 2, y: 1 }, strip)).toBe(true); // front corner
    expect(pointInPolygon({ x: 2, y: 15 }, strip)).toBe(false); // back corner: the room's
  });

  it('is null when the zone lies wholly behind the house', () => {
    const zones = zonesOf(suburbanPlot, suburbanHouse);
    expect(passageStrip(byId(zones, 'back'), suburbanHouse)).toBeNull();
  });

  it('gives both sides of a symmetrical plot the same strip', () => {
    /*
     * A zone's inner edge is the house's wall plane, clipped in floating point, so the two sides
     * come back a nanometre either side of the wall. Testing the strip against the house rejected
     * one and accepted the other, and the suburban plan came out with a paved return down one
     * side and turf down the other.
     */
    const zones = zonesOf(suburbanPlot, suburbanHouse);
    const left = passageStrip(byId(zones, 'left'), suburbanHouse);
    const right = passageStrip(byId(zones, 'right'), suburbanHouse);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(polygonArea(left!)).toBeCloseTo(polygonArea(right!), 6);
  });
});

describe('passageBorderWidth', () => {
  it('leaves a way past the house, and gives up before a bed would block it', () => {
    expect(passageBorderWidth(4.5, 1.5)).toBe(1.5);
    expect(passageBorderWidth(2.5, 1.5)).toBeCloseTo(1.5);
    expect(passageBorderWidth(2.3, 1.5)).toBeCloseTo(1.3);
    expect(passageBorderWidth(2.1, 1.5)).toBe(0);
    expect(passageBorderWidth(1.0, 1.5)).toBe(0);
  });
});

describe('baseFillFor', () => {
  const brief = {
    purpose: '',
    desiredFeatures: ['seating' as const],
    featuresOther: '',
    budget: 'medium' as const,
    maintenance: 'medium' as const,
    style: 'modern' as const,
    styleOther: '',
  };
  const constraints = resolveConstraints(brief, ARCHETYPES[0]!, 150);
  const palette = fillPalette(constraints, 0);

  it('keeps the palette base for every role but a small front', () => {
    for (const role of ['main', 'passage', 'secondary', 'remote'] as const) {
      expect(baseFillFor(role, palette, constraints, 0, { depth: 2.5, area: 20 }).category).toBe('lawn');
    }
    expect(baseFillFor('arrival', palette, constraints, 0, { depth: 4, area: 25 }).category).toBe('lawn');
  });

  it('gravels a front too shallow or too small for a lawn, whatever the budget', () => {
    expect(baseFillFor('arrival', palette, constraints, 0, { depth: 3.9, area: 40 }).category).toBe('gravel-mulch');
    expect(baseFillFor('arrival', palette, constraints, 0, { depth: 5, area: 24 }).category).toBe('gravel-mulch');
    expect(baseFillFor('arrival', palette, constraints, 0, { depth: null, area: 0 }).category).toBe('gravel-mulch');
    const premium = resolveConstraints({ ...brief, budget: 'premium' }, ARCHETYPES[0]!, 150);
    expect(baseFillFor('arrival', fillPalette(premium, 0), premium, 0, { depth: 3, area: 40 }).category).toBe('gravel-mulch');
  });

  it('never lays lawn where the brief forbids it', () => {
    const low = resolveConstraints({ ...brief, maintenance: 'low' }, ARCHETYPES[0]!, 150);
    expect(baseFillFor('arrival', fillPalette(low, 0), low, 0, { depth: 6, area: 60 }).category).not.toBe('lawn');
    expect(baseFillFor('main', fillPalette(low, 0), low, 0, { depth: 6, area: 60 }).category).not.toBe('lawn');
  });
});
