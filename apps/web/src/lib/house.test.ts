import { describe, expect, it } from 'vitest';
import type { Point } from '@garden-studio/schema';
import { polygonArea } from './boundary-geometry';
import {
  clampHouseInside,
  houseArea,
  houseFitsInside,
  houseFromPoints,
  housePolygon,
  houseSize,
  normaliseDegrees,
  polygonContainsPolygon,
  rectangleHouse,
  resizeHouse,
  rotateHouse,
} from './house';

/** A 20 m x 16 m plot, origin top-left. */
const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

describe('housePolygon', () => {
  it('places an unrotated rectangle around its centre', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 10, 8);

    expect(housePolygon(house)).toEqual([
      { x: 5, y: 4 },
      { x: 15, y: 4 },
      { x: 15, y: 12 },
      { x: 5, y: 12 },
    ]);
  });

  it('rotates about the centre, preserving area', () => {
    const house = rotateHouse(rectangleHouse({ x: 10, y: 8 }, 10, 6), 37);
    const polygon = housePolygon(house);

    expect(polygonArea(polygon)).toBeCloseTo(60);
    // The centre is fixed under rotation, so the corners still average back to it.
    const meanX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const meanY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    expect(meanX).toBeCloseTo(10);
    expect(meanY).toBeCloseTo(8);
  });

  it('turns a rectangle onto its side at 90 degrees', () => {
    const polygon = housePolygon(rotateHouse(rectangleHouse({ x: 10, y: 8 }, 10, 4), 90));
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10);
  });
});

describe('houseSize and resizeHouse', () => {
  it('reads the local-frame bounding box', () => {
    expect(houseSize(rectangleHouse({ x: 10, y: 8 }, 10.4, 8.2))).toEqual({
      width: 10.4,
      depth: 8.2,
    });
  });

  it('is unaffected by rotation, since the box is in the house frame', () => {
    const turned = rotateHouse(rectangleHouse({ x: 10, y: 8 }, 10, 4), 90);
    expect(houseSize(turned)).toEqual({ width: 10, depth: 4 });
  });

  it('round-trips through a resize', () => {
    const resized = resizeHouse(rectangleHouse({ x: 10, y: 8 }, 10, 8), { width: 6, depth: 12 });
    expect(houseSize(resized)).toEqual({ width: 6, depth: 12 });
  });

  it('changes only the axis it is given', () => {
    const resized = resizeHouse(rectangleHouse({ x: 10, y: 8 }, 10, 8), { width: 5 });
    expect(houseSize(resized)).toEqual({ width: 5, depth: 8 });
  });

  it('refuses to shrink below the minimum side', () => {
    const resized = resizeHouse(rectangleHouse({ x: 10, y: 8 }, 10, 8), { width: 0.1 });
    expect(houseSize(resized).width).toBe(1);
  });

  it('scales a custom outline proportionally', () => {
    const house = houseFromPoints([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 3, y: 6 },
      { x: 0, y: 4 },
    ]);
    if (!house) throw new Error('expected a house');

    expect(houseSize(resizeHouse(house, { width: 12 })).width).toBeCloseTo(12);
  });

  /*
   * A resize rewrites every coordinate, and building the new points from `{ x, y }` rather than
   * spreading the old ones drops the vertex ids silently. Nothing attaches to a wall yet, but that
   * is the whole reason the ids exist, and a silent renumber is the failure this codebase least
   * tolerates.
   */
  it('keeps the corner ids, so anything attached to a wall stays on it', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 8, 6);
    const ids = house.outline.map((vertex) => vertex.id);

    expect(resizeHouse(house, { width: 12, depth: 9 }).outline.map((v) => v.id)).toEqual(ids);
  });
});

describe('houseFromPoints', () => {
  it('needs three points', () => {
    expect(
      houseFromPoints([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ]),
    ).toBeNull();
  });

  it('recentres the outline without moving the shape on the plan', () => {
    const points = [
      { x: 4, y: 4 },
      { x: 10, y: 4 },
      { x: 10, y: 9 },
      { x: 4, y: 9 },
    ];
    const house = houseFromPoints(points);
    if (!house) throw new Error('expected a house');

    expect(house.centre.x).toBeCloseTo(7);
    expect(house.centre.y).toBeCloseTo(6.5);
    expect(housePolygon(house)).toEqual(points);
  });
});

describe('houseArea', () => {
  it('is zero without a house', () => {
    expect(houseArea(null)).toBe(0);
  });

  it('measures the footprint', () => {
    expect(houseArea(rectangleHouse({ x: 10, y: 8 }, 10, 8))).toBeCloseTo(80);
  });
});

describe('polygonContainsPolygon', () => {
  it('accepts a house well inside the plot', () => {
    expect(houseFitsInside(PLOT, rectangleHouse({ x: 10, y: 8 }, 10, 8))).toBe(true);
  });

  it('rejects a house hanging over the boundary', () => {
    expect(houseFitsInside(PLOT, rectangleHouse({ x: 18, y: 8 }, 10, 8))).toBe(false);
  });

  it('rejects a house larger than the plot', () => {
    expect(houseFitsInside(PLOT, rectangleHouse({ x: 10, y: 8 }, 30, 30))).toBe(false);
  });

  it('rejects a house that spans a concave notch even though its corners are inside', () => {
    // A U-shaped plot: the gap in the middle is outside the property.
    const uShape: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 10 },
      { x: 16, y: 10 },
      { x: 16, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ];
    const spanning = rectangleHouse({ x: 10, y: 13 }, 14, 4);

    // Corners sit in the arms of the U, but the walls cross the notch.
    expect(polygonContainsPolygon(uShape, housePolygon(spanning))).toBe(true);
    expect(houseFitsInside(uShape, rectangleHouse({ x: 10, y: 9 }, 14, 4))).toBe(false);
  });
});

describe('clampHouseInside', () => {
  it('allows a move that stays inside', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 6, 4);
    const moved = clampHouseInside(PLOT, house, { x: 12, y: 9 });

    expect(moved.centre).toEqual({ x: 12, y: 9 });
  });

  it('slides the house up against the fence instead of refusing to move', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 6, 4);
    const moved = clampHouseInside(PLOT, house, { x: 40, y: 8 });

    expect(moved.centre.x).toBeGreaterThan(10);
    expect(moved.centre.x).toBeLessThanOrEqual(17);
    expect(houseFitsInside(PLOT, moved)).toBe(true);
  });

  it('keeps the axis that was already legal', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 6, 4);
    const moved = clampHouseInside(PLOT, house, { x: 40, y: 8 });

    expect(moved.centre.y).toBeCloseTo(8);
  });

  it('leaves a house that never fitted where it was', () => {
    const house = rectangleHouse({ x: 10, y: 8 }, 40, 40);
    expect(clampHouseInside(PLOT, house, { x: 12, y: 8 }).centre).toEqual({ x: 10, y: 8 });
  });
});

describe('normaliseDegrees', () => {
  it('wraps into 0-359', () => {
    expect(normaliseDegrees(370)).toBe(10);
    expect(normaliseDegrees(-90)).toBe(270);
    expect(normaliseDegrees(360)).toBe(0);
  });
});
