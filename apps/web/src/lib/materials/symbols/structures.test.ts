import { describe, expect, it } from 'vitest';
import { pointInPolygon, rectToPolygon, type Point } from '@garden-studio/schema';
import { gardenRoomParts, glazingBars, type RectShape } from './structures';

/**
 * The two glazed buildings, as geometry.
 *
 * Both are drawn twice — by the Konva canvas and by the composer — from these functions, which is
 * the whole reason they are pure and separate. What matters here is not what they look like but
 * that nothing they emit escapes the rectangle the placer measured: an element that draws outside
 * its own footprint is a building the plan says fits where it does not, which is the same class of
 * error `canopy.test.ts` exists to catch for trees.
 */

function rect(overrides: Partial<RectShape> = {}): RectShape {
  return { centre: { x: 10, y: 10 }, width: 4, depth: 3, rotation: 0, ...overrides };
}

/** Every point inside the footprint, allowing for the ring's own edge. */
function inside(shape: RectShape, points: Point[]): boolean {
  const outline = rectToPolygon(shape);
  return points.every((point) => pointInPolygon(point, outline));
}

describe('gardenRoomParts', () => {
  it('keeps the roof plane, the glazing and the mullions inside the footprint', () => {
    const shape = rect();
    const parts = gardenRoomParts(shape);

    // The plane is the footprint, so its corners sit *on* the outline rather than within it.
    expect(parts.plane).toHaveLength(4);
    expect(inside(shape, [...parts.glazing, ...parts.mullions.flat()].map(nudgeIn(shape)))).toBe(
      true,
    );
  });

  it('puts the glazing on the low edge and the high edge opposite it', () => {
    // Which way the roof falls is the only thing a plan can say about a mono-pitch from above, and
    // it has to agree with where the glass is: the tall wall is the one you do not look past.
    const parts = gardenRoomParts(rect());

    const glazingY = average(parts.glazing.map((point) => point.y));
    const lowY = average(parts.low.map((point) => point.y));
    const highY = average(parts.high.map((point) => point.y));

    expect(glazingY).toBeCloseTo(lowY + depthOfBand(parts) / 2, 5);
    expect(highY).toBeGreaterThan(lowY);
  });

  it('scales the glazed band with the building rather than quoting a fixed width', () => {
    // A flat band read as a paving margin on anything but a tiny room. A share keeps a 6 m studio
    // looking like a studio.
    const small = depthOfBand(gardenRoomParts(rect({ depth: 2 })));
    const large = depthOfBand(gardenRoomParts(rect({ depth: 6 })));

    expect(large).toBeGreaterThan(small * 2.5);
  });

  it('follows the rotation rather than the world axes', () => {
    const turned = rect({ rotation: 37 });
    const parts = gardenRoomParts(turned);

    expect(inside(turned, [...parts.glazing, ...parts.mullions.flat()].map(nudgeIn(turned)))).toBe(
      true,
    );
  });
});

describe('glazingBars', () => {
  it('spaces the bars in metres and keeps them inside the roof', () => {
    const shape = rect({ width: 4, depth: 3 });
    const bars = glazingBars(shape, 0.6);

    // 4 m across at 0.6 m spacing, excluding both ends.
    expect(bars).toHaveLength(6);
    expect(inside(shape, bars.flat().map(nudgeIn(shape)))).toBe(true);
  });

  it('emits none for a building narrower than one spacing', () => {
    expect(glazingBars(rect({ width: 0.4, depth: 0.4 }), 0.6)).toEqual([]);
  });

  it('runs the bars across the ridge, not along it', () => {
    // Bars along the ridge would be a ladder rather than a roof: they run eave to eave.
    const [first] = glazingBars(rect({ width: 4, depth: 3 }), 0.6);

    expect(first![0]!.x).toBeCloseTo(first![1]!.x, 5);
    expect(Math.abs(first![0]!.y - first![1]!.y)).toBeCloseTo(3, 5);
  });
});

/** Pulls a point a hair towards the centre, so a point *on* the outline counts as inside. */
function nudgeIn(shape: RectShape): (point: Point) => Point {
  return (point) => ({
    x: point.x + (shape.centre.x - point.x) * 1e-6,
    y: point.y + (shape.centre.y - point.y) * 1e-6,
  });
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function depthOfBand(parts: ReturnType<typeof gardenRoomParts>): number {
  const ys = parts.glazing.map((point) => point.y);
  return Math.max(...ys) - Math.min(...ys);
}
