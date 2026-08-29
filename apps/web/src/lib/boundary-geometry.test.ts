import { describe, expect, it } from 'vitest';
import {
  boundaryEdges,
  boundingBox,
  clipToHalfPlane,
  drawReference,
  edgeLength,
  edgeReflowTargets,
  midpoint,
  nextDrawPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonIsSimple,
  polygonsIntersect,
  rayPolygonIntersection,
  reflowEdge,
  rotatePoint,
  segmentsCross,
  vertexFromMeasurement,
  vertexLabel,
  type BoundaryVertex,
} from './boundary-geometry';
import { formatLength, fromDisplay, toDisplay } from './units';

function vertices(...points: [number, number][]): BoundaryVertex[] {
  return points.map(([x, y], index) => ({ id: `v${index}`, x, y }));
}

/** A 20 m x 16 m plot, origin top-left, +y downwards. */
const PLOT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

describe('vertexLabel', () => {
  it('labels the first 26 corners A to Z', () => {
    expect(vertexLabel(0)).toBe('A');
    expect(vertexLabel(4)).toBe('E');
    expect(vertexLabel(25)).toBe('Z');
  });

  it('rolls over past Z', () => {
    expect(vertexLabel(26)).toBe('AA');
    expect(vertexLabel(27)).toBe('AB');
    expect(vertexLabel(51)).toBe('AZ');
    expect(vertexLabel(52)).toBe('BA');
  });
});

describe('boundaryEdges', () => {
  const square = vertices([0, 0], [10, 0], [10, 8], [0, 8]);

  it('wraps the last edge back to the first vertex when closed', () => {
    const edges = boundaryEdges(square, true);

    expect(edges).toHaveLength(4);
    expect(edges[3].start).toMatchObject({ x: 0, y: 8 });
    expect(edges[3].end).toMatchObject({ x: 0, y: 0 });
  });

  it('omits the closing edge while the polygon is still open', () => {
    const edges = boundaryEdges(square, false);

    expect(edges).toHaveLength(3);
    expect(edges.at(-1)?.end).toMatchObject({ x: 0, y: 8 });
  });

  it('has no edges below two points', () => {
    expect(boundaryEdges(vertices([1, 1]), false)).toEqual([]);
  });
});

describe('edgeLength and midpoint', () => {
  it('measures a diagonal', () => {
    expect(edgeLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('finds the centre of an edge', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 4, y: 10 })).toEqual({ x: 2, y: 5 });
  });
});

describe('polygonArea', () => {
  it('measures a rectangle', () => {
    expect(polygonArea(vertices([0, 0], [10, 0], [10, 8], [0, 8]))).toBe(80);
  });

  it('is independent of winding direction', () => {
    expect(polygonArea(vertices([0, 8], [10, 8], [10, 0], [0, 0]))).toBe(80);
  });

  it('is zero for anything that cannot enclose an area', () => {
    expect(polygonArea(vertices([0, 0], [5, 0]))).toBe(0);
    expect(polygonArea([])).toBe(0);
  });
});

describe('polygonCentroid', () => {
  it('finds the centre of a rectangle', () => {
    const centre = polygonCentroid(vertices([0, 0], [10, 0], [10, 8], [0, 8]));

    expect(centre.x).toBeCloseTo(5);
    expect(centre.y).toBeCloseTo(4);
  });

  it('falls back to the mean for a degenerate polygon', () => {
    // Three collinear points enclose no area, so the area-weighted formula divides by zero.
    const centre = polygonCentroid(vertices([0, 0], [2, 0], [4, 0]));

    expect(centre.x).toBeCloseTo(2);
    expect(centre.y).toBeCloseTo(0);
  });
});

describe('boundingBox', () => {
  it('measures the extent of a shape drawn away from the origin', () => {
    expect(boundingBox(vertices([2, 3], [9, 3], [9, 11]))).toEqual({
      minX: 2,
      minY: 3,
      width: 7,
      length: 8,
    });
  });
});

describe('rotatePoint', () => {
  it('turns a point clockwise about the origin', () => {
    const turned = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);

    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(1);
  });

  it('rotates about an arbitrary centre', () => {
    const turned = rotatePoint({ x: 6, y: 4 }, { x: 4, y: 4 }, 180);

    expect(turned.x).toBeCloseTo(2);
    expect(turned.y).toBeCloseTo(4);
  });

  it('leaves the centre itself alone', () => {
    expect(rotatePoint({ x: 3, y: 3 }, { x: 3, y: 3 }, 37)).toMatchObject({ x: 3, y: 3 });
  });
});

describe('pointInPolygon', () => {
  const plot = vertices([0, 0], [10, 0], [10, 8], [0, 8]);

  it('accepts an interior point and rejects an exterior one', () => {
    expect(pointInPolygon({ x: 5, y: 4 }, plot)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 4 }, plot)).toBe(false);
  });

  it('counts a point on the edge as inside', () => {
    expect(pointInPolygon({ x: 10, y: 4 }, plot)).toBe(true);
  });

  it('handles a concave plot', () => {
    // An L-shape with the bite taken out of the top right.
    const lShape = vertices([0, 0], [6, 0], [6, 4], [10, 4], [10, 8], [0, 8]);

    expect(pointInPolygon({ x: 8, y: 6 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 2 }, lShape)).toBe(false);
  });
});

describe('segmentsCross', () => {
  it('detects a proper crossing', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 })).toBe(
      true,
    );
  });

  it('ignores segments that only touch at an endpoint', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 })).toBe(
      false,
    );
  });
});

describe('rayPolygonIntersection', () => {
  const plot = vertices([0, 0], [20, 0], [20, 16], [0, 16]);

  it('hits the wall the ray is pointing at', () => {
    const hit = rayPolygonIntersection({ x: 10, y: 8 }, { x: 1, y: 0 }, plot);

    expect(hit?.x).toBeCloseTo(20);
    expect(hit?.y).toBeCloseTo(8);
  });

  it('takes the nearest crossing, not the far one', () => {
    const hit = rayPolygonIntersection({ x: 10, y: 8 }, { x: 0, y: -1 }, plot);
    expect(hit?.y).toBeCloseTo(0);
  });

  it('normalises the direction, so its length does not matter', () => {
    const short = rayPolygonIntersection({ x: 10, y: 8 }, { x: 1, y: 0 }, plot);
    const long = rayPolygonIntersection({ x: 10, y: 8 }, { x: 400, y: 0 }, plot);

    expect(long).toEqual(short);
  });

  it('returns null for a ray that never reaches the outline', () => {
    expect(rayPolygonIntersection({ x: 40, y: 8 }, { x: 1, y: 0 }, plot)).toBeNull();
  });

  it('returns null for a degenerate direction', () => {
    expect(rayPolygonIntersection({ x: 10, y: 8 }, { x: 0, y: 0 }, plot)).toBeNull();
  });

  it('stops at the near wall of a concave notch', () => {
    const lShape = vertices([0, 0], [12, 0], [12, 8], [20, 8], [20, 16], [0, 16]);
    const hit = rayPolygonIntersection({ x: 6, y: 4 }, { x: 1, y: 0 }, lShape);

    expect(hit?.x).toBeCloseTo(12);
  });
});

describe('clipToHalfPlane', () => {
  const square = vertices([0, 0], [10, 0], [10, 10], [0, 10]);

  it('keeps the half the normal points towards', () => {
    const clipped = clipToHalfPlane(square, { x: 5, y: 5 }, { x: 1, y: 0 });

    expect(polygonArea(clipped)).toBeCloseTo(50);
    expect(clipped.every((point) => point.x >= 5 - 1e-9)).toBe(true);
  });

  it('returns nothing when the whole shape is on the far side', () => {
    expect(clipToHalfPlane(square, { x: 20, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it('chains into a wedge', () => {
    // Two 45-degree walls either side of "straight down" carve out a quarter.
    const half = Math.SQRT1_2;
    let wedge = clipToHalfPlane(square, { x: 5, y: 5 }, { x: half, y: half });
    wedge = clipToHalfPlane(wedge, { x: 5, y: 5 }, { x: -half, y: half });

    expect(polygonArea(wedge)).toBeCloseTo(25);
    expect(polygonCentroid(wedge).y).toBeGreaterThan(5);
  });
});

describe('polygonIsSimple', () => {
  it('accepts an ordinary plot', () => {
    expect(polygonIsSimple(PLOT)).toBe(true);
  });

  /*
   * The failure this exists to catch: a bow tie has a perfectly ordinary vertex list, and its
   * shoelace area comes out quietly wrong rather than reporting a problem.
   */
  it('rejects a bow tie', () => {
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 0, y: 16 },
        { x: 20, y: 16 },
      ]),
    ).toBe(false);
  });

  it('does not count neighbouring sides meeting at their shared corner', () => {
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(true);
  });

  it('has nothing to check below four corners', () => {
    expect(polygonIsSimple([{ x: 0, y: 0 }])).toBe(true);
  });
});

describe('drawReference', () => {
  it('is due east before there is a side to follow', () => {
    expect(drawReference([])).toEqual({ x: 1, y: 0 });
    expect(drawReference([{ x: 4, y: 4 }])).toEqual({ x: 1, y: 0 });
  });

  it('follows the last side drawn, normalised', () => {
    const reference = drawReference([
      { x: 0, y: 0 },
      { x: 0, y: 6 },
    ]);

    expect(reference.x).toBeCloseTo(0);
    expect(reference.y).toBeCloseTo(1);
  });
});

describe('nextDrawPoint', () => {
  const options = { gridSnap: true, rightAngle: true, unit: 'm' as const };

  it('is a plain grid snap for the very first corner', () => {
    expect(nextDrawPoint([], { x: 4.2, y: 9.9 }, options)).toEqual({ x: 4, y: 10 });
  });

  it('holds the next side square to the one before it', () => {
    const drawn = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];

    // Pointing down and a little off; the side is held vertical and the run kept.
    const point = nextDrawPoint(drawn, { x: 21.4, y: 16.2 }, options);

    expect(point.x).toBeCloseTo(20);
    expect(point.y).toBeCloseTo(16);
  });

  /*
   * The obvious way to write this is to snap the point to the grid at the end, which knocks it
   * straight back off the axis on any plot that is not square to the screen — quietly undoing the
   * whole feature. Only the distance along the side is snapped.
   */
  it('keeps the right angle on a plot drawn off axis', () => {
    const diagonal = Math.SQRT1_2;
    const drawn = [
      { x: 0, y: 0 },
      { x: 10 * diagonal, y: 10 * diagonal },
    ];

    const point = nextDrawPoint(drawn, { x: 0.3, y: 14.4 }, options);
    const dx = point.x - drawn[1]!.x;
    const dy = point.y - drawn[1]!.y;

    // Perpendicular to the previous side, to within floating point.
    expect(dx * diagonal + dy * diagonal).toBeCloseTo(0);
  });

  it('lets the pointer go anywhere with right angles off', () => {
    const drawn = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];

    expect(nextDrawPoint(drawn, { x: 21.4, y: 16.2 }, { ...options, rightAngle: false })).toEqual({
      x: 21.5,
      y: 16,
    });
  });

  it('never places a corner behind the pointer', () => {
    const drawn = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];

    // Pointing back along the previous side: the run is taken as zero rather than negative.
    const point = nextDrawPoint(drawn, { x: 20, y: 0 }, options);

    expect(point).toEqual({ x: 20, y: 0 });
  });
});

describe('vertexFromMeasurement', () => {
  const drawn = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
  ];

  it('turns right by default in the y-downwards frame', () => {
    const point = vertexFromMeasurement(drawn, 8, 90)!;

    expect(point.x).toBeCloseTo(12);
    expect(point.y).toBeCloseTo(8);
  });

  it('carries straight on at zero', () => {
    const point = vertexFromMeasurement(drawn, 5, 0)!;

    expect(point.x).toBeCloseTo(17);
    expect(point.y).toBeCloseTo(0);
  });

  it('takes the measurement exactly, without rounding to the snap step', () => {
    expect(vertexFromMeasurement(drawn, 8.3, 90)!.y).toBeCloseTo(8.3);
  });

  it('has nowhere to measure from with no corners, and refuses a nonsense length', () => {
    expect(vertexFromMeasurement([], 8, 90)).toBeNull();
    expect(vertexFromMeasurement(drawn, 0, 90)).toBeNull();
    expect(vertexFromMeasurement(drawn, 8, Number.NaN)).toBeNull();
  });
});

describe('edgeReflowTargets', () => {
  it('pins the start and moves the end of an ordinary side', () => {
    expect(edgeReflowTargets(4, 1)).toEqual({ anchorIndex: 1, movedIndex: 2 });
  });

  /*
   * The closing edge ends on corner A. Moving that would drag the shape's anchor and change side
   * A->B as a side effect, so it slides its own start instead — and the highlight has to agree
   * with `reflowEdge` about which corner that is.
   */
  it('flips for the closing side', () => {
    expect(edgeReflowTargets(4, 3)).toEqual({ anchorIndex: 0, movedIndex: 3 });
  });

  it('agrees with reflowEdge about the corner that moves', () => {
    const before = vertices([0, 0], [20, 0], [20, 16], [0, 16]);

    for (const edgeIndex of [0, 1, 2, 3]) {
      const after = reflowEdge(before, edgeIndex, 5);
      const targets = edgeReflowTargets(before.length, edgeIndex)!;
      const moved = after.filter((vertex, i) => vertex !== before[i]);

      expect(moved).toHaveLength(1);
      expect(after[targets.movedIndex]).toBe(moved[0]);
      expect(after[targets.anchorIndex]).toBe(before[targets.anchorIndex]);
    }
  });

  it('has no answer for an index that is not a side', () => {
    expect(edgeReflowTargets(4, 4)).toBeNull();
    expect(edgeReflowTargets(1, 0)).toBeNull();
  });
});

describe('reflowEdge', () => {
  const square = vertices([0, 0], [10, 0], [10, 8], [0, 8]);

  it('moves only the end vertex of the edited edge', () => {
    const next = reflowEdge(square, 0, 4);

    expect(next[1]).toMatchObject({ x: 4, y: 0 });
    expect(next[0]).toMatchObject({ x: 0, y: 0 });
    expect(next[2]).toMatchObject({ x: 10, y: 8 });
    expect(next[3]).toMatchObject({ x: 0, y: 8 });
  });

  it('keeps vertex ids so drag targets and React keys survive', () => {
    expect(reflowEdge(square, 1, 3)[2].id).toBe('v2');
  });

  it('moves the start vertex of the closing edge so vertex A stays anchored', () => {
    // Edge 3 runs D -> A. Moving A would drag the origin and change edge A->B too.
    const next = reflowEdge(square, 3, 2);

    expect(next[0]).toMatchObject({ x: 0, y: 0 });
    expect(next[3]).toMatchObject({ x: 0, y: 2 });
  });

  it('reflows along the existing direction of a diagonal edge', () => {
    const next = reflowEdge(vertices([0, 0], [3, 4], [0, 8]), 0, 10);

    expect(next[1].x).toBeCloseTo(6);
    expect(next[1].y).toBeCloseTo(8);
  });

  it('refuses lengths that are not positive, and zero-length edges', () => {
    expect(reflowEdge(square, 0, 0)).toBe(square);
    expect(reflowEdge(square, 0, -3)).toBe(square);

    const degenerate = vertices([1, 1], [1, 1], [5, 5]);
    expect(reflowEdge(degenerate, 0, 4)).toBe(degenerate);
  });

  it('ignores an out-of-range edge index', () => {
    expect(reflowEdge(square, 9, 4)).toBe(square);
  });
});

describe('polygonsIntersect', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('is true for two shapes sharing a corner region', () => {
    const overlapping = [
      { x: 8, y: 8 },
      { x: 16, y: 8 },
      { x: 16, y: 16 },
      { x: 8, y: 16 },
    ];

    expect(polygonsIntersect(square, overlapping)).toBe(true);
  });

  it('is false for shapes that never meet', () => {
    const away = [
      { x: 20, y: 20 },
      { x: 24, y: 20 },
      { x: 24, y: 24 },
      { x: 20, y: 24 },
    ];

    expect(polygonsIntersect(square, away)).toBe(false);
  });

  /*
   * The case a plain edge-crossing test gets wrong, and the same trap the API's note about
   * ST_Overlaps describes: a shed dropped entirely inside a patio has no crossings at all.
   */
  it('is true when one shape is entirely inside the other', () => {
    const inner = [
      { x: 3, y: 3 },
      { x: 6, y: 3 },
      { x: 6, y: 6 },
      { x: 3, y: 6 },
    ];

    expect(polygonsIntersect(square, inner)).toBe(true);
    expect(polygonsIntersect(inner, square)).toBe(true);
  });

  it('is true for two identical outlines', () => {
    expect(polygonsIntersect(square, [...square])).toBe(true);
  });

  // Flush is allowed, exactly as segmentsCross treats a wall against a fence.
  it('is false for shapes that only touch along an edge', () => {
    const flush = [
      { x: 10, y: 0 },
      { x: 18, y: 0 },
      { x: 18, y: 10 },
      { x: 10, y: 10 },
    ];

    expect(polygonsIntersect(square, flush)).toBe(false);
  });

  it('is false for shapes touching at a single corner', () => {
    const corner = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 14 },
      { x: 10, y: 14 },
    ];

    expect(polygonsIntersect(square, corner)).toBe(false);
  });

  it('is false when either shape is degenerate', () => {
    expect(polygonsIntersect(square, [{ x: 1, y: 1 }])).toBe(false);
  });
});

describe('units', () => {
  it('round-trips metres through feet', () => {
    expect(fromDisplay(toDisplay(12.1, 'ft'), 'ft')).toBeCloseTo(12.1);
  });

  it('leaves metres alone', () => {
    expect(toDisplay(7.5, 'm')).toBe(7.5);
    expect(fromDisplay(7.5, 'm')).toBe(7.5);
  });

  it('formats to one decimal place with the unit', () => {
    expect(formatLength(12.14, 'm')).toBe('12.1 m');
    expect(formatLength(3.048, 'ft')).toBe('10.0 ft');
  });
});
