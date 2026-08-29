import { describe, expect, it } from 'vitest';
import type { Point } from '@garden-studio/schema';
import { pointInPolygon } from './boundary-geometry';
import { housePolygon, rectangleHouse, rotateHouse } from './house';
import {
  ALIGNMENT_THRESHOLD,
  alignmentGuides,
  alignmentGuidesFor,
  boxSnapLines,
  collectSnapTargets,
  cornerSnapLines,
  houseOffsetGuides,
  houseSpanGuides,
  SIZE_ANCHOR_CAR,
  sizeAnchorAt,
  snapCentreToAlignment,
  snapDeltaToTargets,
} from './guides';

/** A 20 m x 16 m plot, origin top-left, +y downwards. */
const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

/** 8 m x 6 m, centred: 6 m clear left and right, 5 m clear top and bottom. */
const CENTRED = rectangleHouse({ x: 10, y: 8 }, 8, 6);

function distances(guides: { id: string; distance: number }[]): Record<string, number> {
  return Object.fromEntries(guides.map((guide) => [guide.id, Number(guide.distance.toFixed(3))]));
}

describe('sizeAnchorAt', () => {
  it('parks below the plot, aligned with its left edge', () => {
    // PLOT runs to y = 16, and the car sits 1.5 m clear of it.
    expect(sizeAnchorAt(PLOT)).toEqual({ x: 0, y: 17.5 });
  });

  /*
   * The whole point of the anchor: it never covers the garden, whatever shape the plot is. A car
   * drawn over the drawing would be furniture competing with the thing being measured.
   */
  it('never lands inside the plot', () => {
    const at = sizeAnchorAt(PLOT)!;

    expect(pointInPolygon(at, PLOT)).toBe(false);
    expect(pointInPolygon({ x: at.x + SIZE_ANCHOR_CAR.width, y: at.y }, PLOT)).toBe(false);
    expect(pointInPolygon({ x: at.x, y: at.y + SIZE_ANCHOR_CAR.depth }, PLOT)).toBe(false);
  });

  it('follows a plot that does not start at the origin', () => {
    const shifted = PLOT.map((point) => ({ x: point.x + 40, y: point.y - 5 }));

    expect(sizeAnchorAt(shifted)).toEqual({ x: 40, y: 12.5 });
  });

  it('has nowhere to park until there is a polygon', () => {
    expect(sizeAnchorAt([])).toBeNull();
    expect(sizeAnchorAt(PLOT.slice(0, 2))).toBeNull();
  });
});

describe('houseOffsetGuides', () => {
  it('reports the clearance to each fence', () => {
    expect(distances(houseOffsetGuides(PLOT, CENTRED))).toEqual({
      top: 5,
      bottom: 5,
      left: 6,
      right: 6,
    });
  });

  it('has nothing to measure without a house', () => {
    expect(houseOffsetGuides(PLOT, null)).toEqual([]);
  });

  it('tracks the house as it moves', () => {
    const shifted = rectangleHouse({ x: 6, y: 8 }, 8, 6);
    const offsets = distances(houseOffsetGuides(PLOT, shifted));

    expect(offsets.left).toBeCloseTo(2);
    expect(offsets.right).toBeCloseTo(10);
  });

  it('turns the guides with the house, reporting them in its own frame', () => {
    // A quarter turn clockwise swings the local top wall round to face east, where there is
    // 20 - 13 = 7 m of clearance; the local left wall now faces north, with 8 - 4 = 4 m.
    const offsets = distances(houseOffsetGuides(PLOT, rotateHouse(CENTRED, 90)));

    expect(offsets.top).toBeCloseTo(7);
    expect(offsets.bottom).toBeCloseTo(7);
    expect(offsets.left).toBeCloseTo(4);
    expect(offsets.right).toBeCloseTo(4);
  });

  it('starts each guide on the house wall and ends it on the boundary', () => {
    for (const guide of houseOffsetGuides(PLOT, CENTRED)) {
      expect(pointInPolygon(guide.from, housePolygon(CENTRED))).toBe(true);
      expect(pointInPolygon(guide.to, PLOT)).toBe(true);
    }
  });

  it('measures to the near wall of a concave plot, not through it', () => {
    // An L-shape: the top-right quarter is missing.
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 8 },
      { x: 20, y: 8 },
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ];
    const house = rectangleHouse({ x: 6, y: 4 }, 4, 4);
    const offsets = distances(houseOffsetGuides(lShape, house));

    // The nearest thing to the right is the notch wall at x = 12, not the fence at x = 20.
    expect(offsets.right).toBeCloseTo(4);
  });
});

describe('houseSpanGuides', () => {
  it('spans the house width and depth', () => {
    expect(distances(houseSpanGuides(CENTRED))).toEqual({ width: 8, depth: 6 });
  });

  it('turns with the house', () => {
    const [width] = houseSpanGuides(rotateHouse(CENTRED, 90));

    // Rotated a quarter turn, the width line now runs vertically.
    expect(Math.abs(width.to.x - width.from.x)).toBeCloseTo(0);
    expect(Math.abs(width.to.y - width.from.y)).toBeCloseTo(8);
  });

  it('has nothing to span without a house', () => {
    expect(houseSpanGuides(null)).toEqual([]);
  });
});

describe('alignmentGuides', () => {
  it('finds nothing for a house sitting in open ground', () => {
    expect(alignmentGuides(PLOT, CENTRED)).toEqual([]);
  });

  it('reports a wall lined up with a fence', () => {
    // Left wall at x = 4.1, within the threshold of the fence at x = 0? No — but a house
    // pushed to the left edge is.
    const flush = rectangleHouse({ x: 4.1, y: 8 }, 8, 6);
    const guides = alignmentGuides(PLOT, flush);

    expect(guides).toContainEqual({ axis: 'x', at: 0 });
  });

  it('does not report the same line twice', () => {
    const flush = rectangleHouse({ x: 4, y: 8 }, 8, 6);
    const xs = alignmentGuides(PLOT, flush).filter((guide) => guide.axis === 'x');

    expect(new Set(xs.map((guide) => guide.at)).size).toBe(xs.length);
  });
});

describe('snapCentreToAlignment', () => {
  it('pulls a nearly flush wall exactly onto the fence', () => {
    const snapped = snapCentreToAlignment(PLOT, CENTRED, { x: 4.2, y: 8 });

    // Left wall lands on x = 0, so the centre lands on half the width.
    expect(snapped.x).toBeCloseTo(4);
    expect(snapped.y).toBeCloseTo(8);
  });

  it('leaves a house that is not near anything alone', () => {
    const centre = { x: 10, y: 8 };
    expect(snapCentreToAlignment(PLOT, CENTRED, centre)).toEqual(centre);
  });

  it('never moves further than the threshold', () => {
    const centre = { x: 4.25, y: 11.2 };
    const snapped = snapCentreToAlignment(PLOT, CENTRED, centre);

    expect(Math.abs(snapped.x - centre.x)).toBeLessThanOrEqual(ALIGNMENT_THRESHOLD + 1e-9);
    expect(Math.abs(snapped.y - centre.y)).toBeLessThanOrEqual(ALIGNMENT_THRESHOLD + 1e-9);
  });
});

/*
 * The generalised engine underneath `alignmentGuides` and `snapCentreToAlignment`. Step 2 feeds
 * it other placed features as well as the plot, so these cases use a second shape as the target
 * rather than the boundary.
 */
describe('the snap engine', () => {
  /** A 4 m x 2 m patio with its left edge on x = 6. */
  const PATIO = [
    { x: 6, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 12 },
    { x: 6, y: 12 },
  ];

  it('offers each shape its two edges and its middle, per axis', () => {
    expect(boxSnapLines(PATIO)).toEqual({ x: [6, 8, 10], y: [10, 11, 12] });
  });

  it('offers every corner of the plot', () => {
    expect(cornerSnapLines(PLOT).x).toEqual([0, 20, 20, 0]);
  });

  it('is empty for a shape with no points', () => {
    expect(boxSnapLines([])).toEqual({ x: [], y: [] });
    expect(snapDeltaToTargets([], boxSnapLines(PATIO))).toEqual({ x: 0, y: 0 });
  });

  it('gathers targets from several shapes at once', () => {
    const targets = collectSnapTargets([boxSnapLines(PATIO), cornerSnapLines(PLOT)]);

    expect(targets.x).toContain(6);
    expect(targets.x).toContain(20);
  });

  it('pulls a shed edge onto a patio edge it is nearly level with', () => {
    // Left edge at 6.2, a fifth of a metre from the patio's at 6.
    const shed = [
      { x: 6.2, y: 2 },
      { x: 8.2, y: 2 },
      { x: 8.2, y: 4 },
      { x: 6.2, y: 4 },
    ];

    const delta = snapDeltaToTargets(shed, boxSnapLines(PATIO));
    expect(delta.x).toBeCloseTo(-0.2, 6);
  });

  it('leaves a shape alone when nothing is within the threshold', () => {
    const away = [
      { x: 15, y: 2 },
      { x: 17, y: 2 },
      { x: 17, y: 4 },
      { x: 15, y: 4 },
    ];

    expect(snapDeltaToTargets(away, boxSnapLines(PATIO))).toEqual({ x: 0, y: 0 });
  });

  it('takes the nearest target when several are in range', () => {
    // 6.1 is nearer the patio's left edge at 6 than its middle at 8.
    const shed = [
      { x: 6.1, y: 2 },
      { x: 7.9, y: 2 },
      { x: 7.9, y: 4 },
      { x: 6.1, y: 4 },
    ];

    expect(snapDeltaToTargets(shed, boxSnapLines(PATIO)).x).toBeCloseTo(-0.1, 6);
  });

  it('reports a guide on the line it actually snapped to', () => {
    const shed = [
      { x: 6, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 4 },
      { x: 6, y: 4 },
    ];

    const guides = alignmentGuidesFor(shed, boxSnapLines(PATIO));
    expect(guides).toContainEqual({ axis: 'x', at: 6 });
  });

  it('reports one guide per coordinate, however many shapes agree on it', () => {
    const targets = collectSnapTargets([boxSnapLines(PATIO), boxSnapLines(PATIO)]);
    const shed = [
      { x: 6, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 4 },
      { x: 6, y: 4 },
    ];

    expect(
      alignmentGuidesFor(shed, targets).filter((g) => g.axis === 'x' && g.at === 6),
    ).toHaveLength(1);
  });
});
