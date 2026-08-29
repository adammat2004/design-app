import { describe, expect, it } from 'vitest';
import { polygonArea } from './primitives.js';
import { circleRing, polylineStrip, rectToPolygon, roundPolygon } from './shapes.js';

describe('rectToPolygon', () => {
  it('returns the four corners about the centre when unrotated', () => {
    expect(rectToPolygon({ centre: { x: 3, y: 3 }, width: 4, depth: 2, rotation: 0 })).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
    ]);
  });

  it('rotates about the centre, preserving the centre and the side lengths', () => {
    const polygon = rectToPolygon({ centre: { x: 2, y: 1 }, width: 4, depth: 2, rotation: 90 });

    const centreX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const centreY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    expect(centreX).toBeCloseTo(2);
    expect(centreY).toBeCloseTo(1);

    const firstSide = Math.hypot(polygon[1]!.x - polygon[0]!.x, polygon[1]!.y - polygon[0]!.y);
    expect(firstSide).toBeCloseTo(4);
  });

  /*
   * Rotation direction is a contract with PostGIS, not just with Konva: the placer builds its
   * candidate boxes with ST_Rotate, and in this y-down frame the standard rotation matrix reads
   * as clockwise. A rectangle turned 90 degrees must put its first corner where both agree.
   */
  it('turns clockwise in the y-down frame', () => {
    const [first] = rectToPolygon({ centre: { x: 0, y: 0 }, width: 4, depth: 2, rotation: 90 });

    expect(first!.x).toBeCloseTo(1);
    expect(first!.y).toBeCloseTo(-2);
  });
});

describe('circleRing', () => {
  it('produces one point per segment', () => {
    expect(circleRing({ x: 0, y: 0 }, 1)).toHaveLength(16);
    expect(circleRing({ x: 0, y: 0 }, 1, 8)).toHaveLength(8);
  });

  /*
   * The ring is inscribed, so it is always slightly smaller than the true circle. That is the
   * safe direction for a hard constraint — the validator errs towards permissive — but it only
   * holds because the canvas and the validator use this same function. A 16-gon against the
   * octagon the editor used to draw differed by ~7.6% of the radius, which is enough to reject a
   * tree the user could see was inside the fence.
   */
  it('is inscribed, and close enough to the true circle to share with the validator', () => {
    const area = polygonArea(circleRing({ x: 0, y: 0 }, 2));
    const trueArea = Math.PI * 4;

    expect(area).toBeLessThan(trueArea);
    expect(area / trueArea).toBeGreaterThan(0.97);
  });
});

describe('roundPolygon', () => {
  it('leaves the ring alone when the radius is zero', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];

    expect(roundPolygon(square, 0)).toEqual(square);
  });

  it('clamps the radius to half the shorter edge rather than folding the outline', () => {
    const narrow = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 1 },
      { x: 0, y: 1 },
    ];

    const rounded = roundPolygon(narrow, 99);

    // Still a sane ring inside the original bounding box, not an inside-out shape.
    for (const point of rounded) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.x).toBeLessThanOrEqual(8 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      expect(point.y).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(polygonArea(rounded)).toBeGreaterThan(0);
  });
});

describe('polylineStrip', () => {
  /*
   * Flat caps and mitred joins, deliberately unlike ST_Buffer's round ones. A buffered line is
   * larger at the ends, so a path laid flush against a fence would pass in the editor and fail on
   * the server — the server being stricter than the canvas is the one failure mode the shared
   * tessellation exists to prevent.
   */
  it('cuts the ends square, so a straight run is exactly length x width', () => {
    const strip = polylineStrip(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    );

    expect(polygonArea(strip)).toBeCloseTo(20);
  });

  it('returns nothing for a single point', () => {
    expect(polylineStrip([{ x: 0, y: 0 }], 1)).toEqual([]);
  });
});
