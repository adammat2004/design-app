import { describe, expect, it } from 'vitest';
import { CIRCLE_SEGMENTS, type Point } from '@garden-studio/schema';
import { pointInPolygon } from './boundary-geometry';
import {
  defaultFeatureName,
  featureAnchor,
  featureArea,
  featureBounds,
  featureClearsHouse,
  featureFitsInside,
  featureOutline,
  moveFeature,
  polylineLength,
  polylineStrip,
  resizeFeature,
  rotateFeature,
  roundPolygon,
  setCornerRadius,
  summariseFeatures,
  translateFeature,
  type PlanGeometry,
  type PlacedFeature,
} from './features';

/** A 8 m x 6 m house sitting in the middle of the plot. */
const HOUSE: Point[] = [
  { x: 6, y: 5 },
  { x: 14, y: 5 },
  { x: 14, y: 11 },
  { x: 6, y: 11 },
];

let counter = 0;
function feature(geometry: PlanGeometry, overrides: Partial<PlacedFeature> = {}): PlacedFeature {
  counter += 1;
  return {
    id: `f${counter}`,
    kind: 'other',
    name: 'Thing',
    geometry,
    status: 'keep',
    replaceWith: null,
    ...overrides,
  };
}

describe('featureArea', () => {
  it('is zero for a point feature', () => {
    expect(featureArea(feature({ kind: 'point', at: { x: 2, y: 2 }, radius: 1.5 }))).toBe(0);
  });

  it('is width times depth for a rectangle', () => {
    const rect = feature({
      kind: 'rect',
      centre: { x: 3, y: 3 },
      width: 2.5,
      depth: 2,
      rotation: 0,
    });

    expect(featureArea(rect)).toBeCloseTo(5, 6);
  });

  it('is unchanged by rotating a rectangle', () => {
    const upright = feature({
      kind: 'rect',
      centre: { x: 3, y: 3 },
      width: 4,
      depth: 2,
      rotation: 0,
    });
    const turned = feature({
      kind: 'rect',
      centre: { x: 3, y: 3 },
      width: 4,
      depth: 2,
      rotation: 37,
    });

    expect(featureArea(turned)).toBeCloseTo(featureArea(upright), 6);
  });

  it('is the shoelace area for a polygon', () => {
    const patio = feature({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 4 },
        { x: 0, y: 4 },
      ],
    });

    expect(featureArea(patio)).toBeCloseTo(24, 6);
  });

  it('is run length times width for a line', () => {
    // Two 5 m legs at 1 m wide.
    const path = feature({
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      width: 1,
    });

    expect(
      polylineLength(path.geometry.kind === 'polyline' ? path.geometry.points : []),
    ).toBeCloseTo(10, 6);
    expect(featureArea(path)).toBeCloseTo(10, 6);
  });
});

describe('featureOutline', () => {
  /*
   * The ring used to be an octagon here and a 64-gon in the PostGIS validator, which made the
   * server's circle up to 7.6% of the radius larger — enough to reject a tree the user could
   * see was inside the fence. Both sides now call the shared `circleRing`, so the segment count
   * is a contract rather than a local detail.
   */
  it('rings a point feature at its radius, with the shared segment count', () => {
    const tree = feature({ kind: 'point', at: { x: 4, y: 4 }, radius: 1.5 });
    const outline = featureOutline(tree);

    expect(outline).toHaveLength(CIRCLE_SEGMENTS);
    for (const corner of outline) {
      expect(Math.hypot(corner.x - 4, corner.y - 4)).toBeCloseTo(1.5, 6);
    }
  });

  it('applies a rectangle’s rotation about its centre', () => {
    const shed = feature({
      kind: 'rect',
      centre: { x: 10, y: 10 },
      width: 4,
      depth: 2,
      rotation: 90,
    });

    const outline = featureOutline(shed);
    const xs = outline.map((corner) => corner.x);
    const ys = outline.map((corner) => corner.y);

    // A quarter turn swaps the footprint's extents.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 6);
  });
});

describe('polylineStrip', () => {
  it('is empty for fewer than two points', () => {
    expect(polylineStrip([{ x: 0, y: 0 }], 1)).toEqual([]);
  });

  it('wraps the line in a ribbon of the given width', () => {
    const strip = polylineStrip(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    );

    // One point per side, so a two-point line gives four corners.
    expect(strip).toHaveLength(4);
    // A point 0.5 m off the centre line is covered; one 2 m off is not.
    expect(pointInPolygon({ x: 5, y: 0.5 }, strip)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 2 }, strip)).toBe(false);
  });
});

describe('featureAnchor', () => {
  it('sits on the line for a polyline rather than inside its bend', () => {
    const path = feature({
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      width: 1,
    });

    // Midpoint of the second segment, not the centroid of the L.
    expect(featureAnchor(path)).toEqual({ x: 10, y: 5 });
  });

  it('is the centre of a rectangle', () => {
    const shed = feature({
      kind: 'rect',
      centre: { x: 3, y: 7 },
      width: 2,
      depth: 2,
      rotation: 45,
    });

    expect(featureAnchor(shed)).toEqual({ x: 3, y: 7 });
  });
});

describe('moveFeature', () => {
  it('puts the anchor on the target and keeps the shape', () => {
    const patio = feature({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    });

    const moved = moveFeature(patio, { x: 12, y: 12 });

    expect(featureAnchor(moved).x).toBeCloseTo(12, 6);
    expect(featureAnchor(moved).y).toBeCloseTo(12, 6);
    expect(featureArea(moved)).toBeCloseTo(featureArea(patio), 6);
  });

  it('translates every kind of geometry', () => {
    const tree = feature({ kind: 'point', at: { x: 1, y: 1 }, radius: 1 });
    const moved = translateFeature(tree, 2, 3);

    expect(moved.geometry).toEqual({ kind: 'point', at: { x: 3, y: 4 }, radius: 1 });
  });
});

describe('featureClearsHouse', () => {
  it('allows anything when no house has been placed', () => {
    const shed = feature({
      kind: 'rect',
      centre: { x: 10, y: 8 },
      width: 2,
      depth: 2,
      rotation: 0,
    });

    expect(featureClearsHouse(shed, null)).toBe(true);
  });

  it('rejects a feature sitting on the house', () => {
    const shed = feature({
      kind: 'rect',
      centre: { x: 10, y: 8 },
      width: 2,
      depth: 2,
      rotation: 0,
    });

    expect(featureClearsHouse(shed, HOUSE)).toBe(false);
  });

  it('rejects a feature entirely inside the house', () => {
    const tree = feature({ kind: 'point', at: { x: 10, y: 8 }, radius: 0.5 });

    expect(featureClearsHouse(tree, HOUSE)).toBe(false);
  });

  it('allows a patio butting flush up against a wall', () => {
    const patio = feature({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 6, y: 11 },
        { x: 14, y: 11 },
        { x: 14, y: 15 },
        { x: 6, y: 15 },
      ],
    });

    expect(featureClearsHouse(patio, HOUSE)).toBe(true);
  });

  it('rejects a path crossing the house', () => {
    const path = feature({
      kind: 'polyline',
      points: [
        { x: 0, y: 8 },
        { x: 20, y: 8 },
      ],
      width: 1,
    });

    expect(featureClearsHouse(path, HOUSE)).toBe(false);
  });

  it('allows a path running past it', () => {
    const path = feature({
      kind: 'polyline',
      points: [
        { x: 0, y: 14 },
        { x: 20, y: 14 },
      ],
      width: 1,
    });

    expect(featureClearsHouse(path, HOUSE)).toBe(true);
  });
});

describe('roundPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('leaves the shape alone at zero radius', () => {
    expect(roundPolygon(square, 0)).toBe(square);
  });

  it('leaves a degenerate shape alone', () => {
    expect(
      roundPolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        1,
      ),
    ).toHaveLength(2);
  });

  it('takes area off the corners rather than adding it', () => {
    const rounded = roundPolygon(square, 1);
    const area = featureArea(feature({ kind: 'polygon', points: square, cornerRadius: 1 }));

    expect(rounded.length).toBeGreaterThan(square.length);
    expect(area).toBeLessThan(100);
    // Only the corners are cut, so the loss is small next to the whole square.
    expect(area).toBeGreaterThan(95);
  });

  it('takes more area off as the radius grows', () => {
    const gentle = featureArea(feature({ kind: 'polygon', points: square, cornerRadius: 0.5 }));
    const heavy = featureArea(feature({ kind: 'polygon', points: square, cornerRadius: 2 }));

    expect(heavy).toBeLessThan(gentle);
  });

  it('keeps the rounded outline inside the square one', () => {
    for (const corner of roundPolygon(square, 2)) {
      expect(pointInPolygon(corner, square)).toBe(true);
    }
  });

  /*
   * A radius wider than the shape must clamp per corner rather than fold the outline through
   * itself — the failure mode would be a negative area or a self-intersecting ring.
   */
  it('clamps a radius bigger than the shape', () => {
    const narrow = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 1 },
      { x: 0, y: 1 },
    ];
    const area = featureArea(feature({ kind: 'polygon', points: narrow, cornerRadius: 50 }));

    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(8);
  });

  it('is reflected in the outline used for hit-testing, not just the drawing', () => {
    const patio = feature({ kind: 'polygon', points: square, cornerRadius: 3 });

    // The square's corner is cut away, so a point just inside it no longer belongs to the shape.
    expect(pointInPolygon({ x: 0.2, y: 0.2 }, featureOutline(patio))).toBe(false);
    expect(pointInPolygon({ x: 5, y: 5 }, featureOutline(patio))).toBe(true);
  });
});

describe('setCornerRadius', () => {
  const patio = () =>
    feature({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    });

  it('clamps to the allowed range', () => {
    expect(setCornerRadius(patio(), -5).geometry).toMatchObject({ cornerRadius: 0 });
    expect(setCornerRadius(patio(), 99).geometry).toMatchObject({ cornerRadius: 3 });
  });

  it('leaves other geometry kinds untouched', () => {
    const tree = feature({ kind: 'point', at: { x: 1, y: 1 }, radius: 1 });
    expect(setCornerRadius(tree, 1)).toBe(tree);
  });
});

describe('resizeFeature and rotateFeature', () => {
  const shed = () =>
    feature({ kind: 'rect', centre: { x: 5, y: 5 }, width: 3, depth: 2, rotation: 0 });

  it('resizes about the centre', () => {
    const bigger = resizeFeature(shed(), { width: 6 });

    expect(featureAnchor(bigger)).toEqual({ x: 5, y: 5 });
    expect(featureArea(bigger)).toBeCloseTo(12, 6);
  });

  it('refuses to shrink below the minimum side', () => {
    expect(resizeFeature(shed(), { width: 0.01 }).geometry).toMatchObject({ width: 0.3 });
  });

  it('normalises rotation and keeps the area', () => {
    const turned = rotateFeature(shed(), 450);

    expect(turned.geometry).toMatchObject({ rotation: 90 });
    expect(featureArea(turned)).toBeCloseTo(6, 6);
  });

  it('leaves shapes without a frame untouched', () => {
    const tree = feature({ kind: 'point', at: { x: 1, y: 1 }, radius: 1 });
    expect(rotateFeature(tree, 45)).toBe(tree);
  });
});

describe('featureFitsInside', () => {
  const PLOT: Point[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 16 },
    { x: 0, y: 16 },
  ];

  it('accepts a feature well inside the plot', () => {
    const tree = feature({ kind: 'point', at: { x: 10, y: 3 }, radius: 1 });
    expect(featureFitsInside(tree, PLOT)).toBe(true);
  });

  it('rejects one straddling the fence', () => {
    const tree = feature({ kind: 'point', at: { x: 0.5, y: 3 }, radius: 1.5 });
    expect(featureFitsInside(tree, PLOT)).toBe(false);
  });

  it('rejects one entirely outside', () => {
    const tree = feature({ kind: 'point', at: { x: 40, y: 40 }, radius: 1 });
    expect(featureFitsInside(tree, PLOT)).toBe(false);
  });

  it('allows anything when no boundary has been drawn', () => {
    const tree = feature({ kind: 'point', at: { x: 40, y: 40 }, radius: 1 });
    expect(featureFitsInside(tree, [])).toBe(true);
  });

  /*
   * The case a corners-only containment test gets wrong, and the reason this reuses the house's
   * `polygonContainsPolygon`: every corner is on the property, but an edge crosses the notch.
   */
  it('rejects a shape spanning a concave notch with all its corners inside', () => {
    const lShaped: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 6 },
      { x: 10, y: 6 },
      { x: 10, y: 16 },
      { x: 0, y: 16 },
    ];
    const patio = feature({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 2 },
        { x: 18, y: 2 },
        { x: 18, y: 4 },
        { x: 2, y: 14 },
      ],
    });

    expect(
      patio.geometry.kind === 'polygon' &&
        patio.geometry.points.every((point) => pointInPolygon(point, lShaped)),
    ).toBe(true);
    expect(featureFitsInside(patio, lShaped)).toBe(false);
  });
});

describe('featureBounds', () => {
  it('boxes the drawn outline, rotation included', () => {
    const shed = feature({
      kind: 'rect',
      centre: { x: 10, y: 10 },
      width: 4,
      depth: 2,
      rotation: 90,
    });
    const bounds = featureBounds(shed);

    expect(bounds.width).toBeCloseTo(2, 6);
    expect(bounds.length).toBeCloseTo(4, 6);
    expect(bounds.minX).toBeCloseTo(9, 6);
  });
});

describe('defaultFeatureName', () => {
  it('uses the plain type name when it is free', () => {
    expect(defaultFeatureName('patio', [])).toBe('Patio/Deck');
  });

  it('counts up past names already taken', () => {
    const existing = [
      feature({ kind: 'point', at: { x: 0, y: 0 }, radius: 1 }, { name: 'Tree' }),
      feature({ kind: 'point', at: { x: 1, y: 1 }, radius: 1 }, { name: 'Tree 2' }),
    ];

    expect(defaultFeatureName('tree', existing)).toBe('Tree 3');
  });
});

describe('summariseFeatures', () => {
  it('counts each status', () => {
    const features = [
      feature({ kind: 'point', at: { x: 0, y: 0 }, radius: 1 }),
      feature({ kind: 'point', at: { x: 1, y: 1 }, radius: 1 }, { status: 'remove' }),
      feature({ kind: 'point', at: { x: 2, y: 2 }, radius: 1 }, { status: 'replace' }),
      feature({ kind: 'point', at: { x: 3, y: 3 }, radius: 1 }, { status: 'replace' }),
    ];

    expect(summariseFeatures(features)).toEqual({ total: 4, keep: 1, remove: 1, replace: 2 });
  });

  it('is all zeroes for an empty garden', () => {
    expect(summariseFeatures([])).toEqual({ total: 0, keep: 0, remove: 0, replace: 0 });
  });
});
