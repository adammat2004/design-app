import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, type Point } from '@garden-studio/schema';
import { beamLines, canopyCrown, canopyRing, firePitRings } from './canopy';

const centre: Point = { x: 5, y: 4 };

describe('canopyRing', () => {
  it('is stable for one tree, so a canopy does not reshuffle on pan', () => {
    // The same property the surface patterns hold, and the most visible place to lose it.
    expect(canopyRing(centre, 1.6, 'tree-1')).toEqual(canopyRing(centre, 1.6, 'tree-1'));
  });

  it('gives two trees different outlines', () => {
    expect(canopyRing(centre, 1.6, 'tree-1')).not.toEqual(canopyRing(centre, 1.6, 'tree-2'));
  });

  it('stays inside the radius the placer reserved for it', () => {
    /*
     * Load-bearing. The generator erodes the placement region by exactly this radius, so a lobe
     * reaching past it would put a canopy over the fence that the validator then refuses.
     */
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      for (const point of canopyRing(centre, 1.6, seed)) {
        expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
  });

  it('does not fold through its own centre', () => {
    // A lobe shorter than the centre would cross the outline and draw a bow-tie.
    for (const point of canopyRing(centre, 1.6, 'tree-1')) {
      expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeGreaterThan(0.5);
    }
  });

  it('reads as round rather than as a polygon', () => {
    const ring = canopyRing(centre, 2, 'tree-1');
    // Comfortably more than the four or five points that would read as a drawn shape.
    expect(ring.length).toBeGreaterThanOrEqual(9);
  });
});

describe('canopyCrown', () => {
  it('sits inside the canopy it lights', () => {
    const canopy = canopyRing(centre, 1.6, 'tree-1');
    const crown = canopyCrown(centre, 1.6, 'tree-1');

    expect(polygonArea(crown)).toBeLessThan(polygonArea(canopy));
    for (const point of crown) {
      expect(pointInPolygon(point, canopy)).toBe(true);
    }
  });

  it('is offset towards the light rather than centred', () => {
    // Centred, it would read as a ring; offset, it reads as the lit top of one object.
    const crown = canopyCrown(centre, 1.6, 'tree-1');
    const mean = crown.reduce(
      (sum, point) => ({ x: sum.x + point.x / crown.length, y: sum.y + point.y / crown.length }),
      { x: 0, y: 0 },
    );

    expect(Math.hypot(mean.x - centre.x, mean.y - centre.y)).toBeGreaterThan(0.1);
  });
});

describe('firePitRings', () => {
  it('draws a rim inside the pit and a flame inside the rim', () => {
    const { rim, flame } = firePitRings(centre, 1.4);

    for (const point of rim) {
      expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThan(1.4);
    }
    expect(polygonArea(flame)).toBeGreaterThan(0);
    expect(polygonArea(flame)).toBeLessThan(polygonArea(rim));
  });
});

describe('beamLines', () => {
  it('spans the shorter side, the way a real beam does', () => {
    // 4 m wide, 2 m deep: beams run across the 2 m depth, so each is 2 m long.
    const beams = beamLines(centre, 4, 2, 0);

    expect(beams.length).toBeGreaterThan(0);
    for (const [start, end] of beams) {
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(4, 6);
    }
  });

  it('turns with the structure', () => {
    const straight = beamLines(centre, 4, 2, 0);
    const turned = beamLines(centre, 4, 2, 90);

    expect(turned).not.toEqual(straight);
    expect(turned.length).toBe(straight.length);
  });

  it('stays within the footprint', () => {
    const footprint: Point[] = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 5 },
      { x: 3, y: 5 },
    ];

    for (const [start, end] of beamLines(centre, 4, 2, 0)) {
      expect(pointInPolygon(start, footprint)).toBe(true);
      expect(pointInPolygon(end, footprint)).toBe(true);
    }
  });
});
