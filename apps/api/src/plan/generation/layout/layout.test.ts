import { describe, expect, it } from 'vitest';
import {
  geometryOutline,
  polygonArea,
  polygonContainsPolygon,
  rectangleHouse,
  type HouseFootprint,
  type Point,
} from '@garden-studio/schema';
import { fitInSlot, floorScale, type FitContext } from './fit.js';
import { backFrame, frontFrame, gardenRoom, localBox, sideReturn } from './frame.js';
import { frontGarden } from './front.js';
import {
  BED_MIN_DEPTH,
  isCourtyard,
  LAWN_FLOOR,
  lawnEnd,
  lawnStart,
  lawnViable,
  PERGOLA_FLOOR,
  rearBedDepth,
  roomBehind,
  TERRACE_FLOOR,
  terraceDepth,
  terraceRect,
  terraceWidth,
  type Room,
  type SketchRequest,
} from './sketch.js';

/**
 * The grammar is pure, so every test here runs without a database: a plot, a house, a brief's
 * worth of features, and the sketch that comes out. What is pinned is the *composition* — the
 * terrace is across the door, the lawn is one panel inside the room, the formal plan mirrors —
 * not any particular coordinate.
 */

/** 20 × 16 m plot, house 8 × 6 at (10, 4) facing +y: the back garden is the strip above y = 1. */
const plot: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

function house(overrides: Partial<HouseFootprint> = {}): HouseFootprint {
  const base = rectangleHouse({ x: 10, y: 10 }, 8, 6);
  return {
    ...base,
    openings: [
      {
        id: 'o1',
        wallId: 'w0',
        offsetAlongEdge: 4,
        width: 2.4,
        type: 'patio-door',
        sillHeight: 0,
        floorLevel: 0,
        swing: 'none',
      },
    ],
    ...overrides,
  };
}

function request(overrides: Partial<SketchRequest> = {}): SketchRequest {
  return {
    features: ['seating', 'pergola', 'play', 'firePit', 'storage'],
    scale: 1,
    style: 'modern',
    lawnAllowed: true,
    gateSide: 'right',
    houseWallLength: 8,
    doorWidth: 2.4,
    ...overrides,
  };
}

describe('backFrame', () => {
  it('starts at the patio door and points out of the house', () => {
    const frame = backFrame(house())!;
    expect(frame.source).toBe('door');
    // The house's top wall (w0) is at y = 7; the door is centred on it at x = 10.
    expect(frame.origin.x).toBeCloseTo(10);
    expect(frame.origin.y).toBeCloseTo(7);
    expect(frame.axis.y).toBeCloseTo(-1);
    expect(frame.wallBearing).toBeCloseTo(0);
    // `v` runs right when looking out: out is -y, so right is +x in this y-down frame.
    expect(frame.cross.x).toBeCloseTo(1);
  });

  it("falls back to the back wall's midpoint when there is no door", () => {
    const frame = backFrame(house({ openings: [] }))!;
    expect(frame.source).toBe('wall');
    expect(frame.origin.y).toBeCloseTo(7);
  });

  it('turns with the house', () => {
    const frame = backFrame(house({ rotation: 90 }))!;
    expect(Math.abs(frame.axis.x)).toBeCloseTo(1);
    expect(Math.abs(frame.wallBearing) % 180).toBeCloseTo(90);
  });

  it('round-trips a point through local and back', () => {
    const frame = backFrame(house())!;
    const world = frame.toWorld(3, -2);
    const local = frame.toLocal(world);
    expect(local.u).toBeCloseTo(3);
    expect(local.v).toBeCloseTo(-2);
  });
});

describe('gardenRoom', () => {
  it('is the whole plot behind the door wall when every zone is in scope', () => {
    const frame = backFrame(house())!;
    const room = gardenRoom(plot, house(), frame, ['front', 'back', 'left', 'right']);
    expect(polygonArea(room)).toBeCloseTo(20 * 7);
    const box = localBox(room, frame);
    expect(box.uMin).toBeCloseTo(0);
    expect(box.uMax).toBeCloseTo(7);
    expect(box.vMin).toBeCloseTo(-10);
    expect(box.vMax).toBeCloseTo(10);
  });

  it('leaves a side alone when that side is not being designed', () => {
    const frame = backFrame(house())!;
    const room = gardenRoom(plot, house(), frame, ['back', 'left']);
    const box = localBox(room, frame);
    expect(box.vMax).toBeCloseTo(4);
    expect(box.vMin).toBeCloseTo(-10);
  });

  it('knows the side returns', () => {
    const right = sideReturn(plot, house(), 'right');
    expect(polygonArea(right)).toBeCloseTo(6 * 6);
  });
});

describe('the terrace', () => {
  const room: Room = { uMin: 0, uMax: 7, vMin: -10, vMax: 10 };

  it('spans the door and sits against the wall', () => {
    const terrace = terraceRect(request(), room);
    expect(terrace.u0).toBe(0);
    expect(terrace.v0).toBeLessThanOrEqual(-1.2);
    expect(terrace.v1).toBeGreaterThanOrEqual(1.2);
    expect(terrace.u1).toBeGreaterThanOrEqual(TERRACE_FLOOR.depth - 1e-9);
    expect(terrace.u1).toBeLessThanOrEqual(0.45 * 7 + 1e-9);
  });

  it('derives its floor from the sofa set, and the share cap never overrides it', () => {
    // sofa-set is 3.0 × 2.4; with the 0.3 m margin all round that is 3.6 × 3.0.
    expect(TERRACE_FLOOR).toEqual({ width: 3.6, depth: 3 });
    expect(PERGOLA_FLOOR).toEqual({ width: 3, depth: 3 });
    // A 3 m deep room used to get a 1.05 m terrace: the cap now sits above the floor.
    expect(terraceDepth(1, 3)).toBe(3);
    expect(terraceDepth(1, 9)).toBeCloseTo(3.15);
    expect(terraceDepth(1, 16)).toBeCloseTo(3.6);
    expect(terraceDepth(2.5, 40)).toBe(5.5);
    // And the floor is capped only by the room: a 2 m deep room gets 2 m.
    expect(terraceDepth(1, 2)).toBe(2);
  });

  it('keeps a terrace in a narrow room by capping the width floor to the room', () => {
    const narrow: Room = { uMin: 0, uMax: 22, vMin: -1.85, vMax: 1.85 };
    expect(terraceWidth(request({ houseWallLength: 3.7 }), narrow)).toBeCloseTo(3.3);
    const terrace = terraceRect(request({ houseWallLength: 3.7 }), narrow);
    expect(terrace.v1 - terrace.v0).toBeCloseTo(3.3);
  });

  it('calls a room a courtyard when no viable lawn fits behind the terrace', () => {
    expect(isCourtyard(1, 4, 8)).toBe(true);
    expect(isCourtyard(1, 12, 18)).toBe(false);
    expect(isCourtyard(1, 9, 20)).toBe(false);
    // Deep enough, but too narrow for a lawn beside a border.
    expect(isCourtyard(1, 12, 3.5)).toBe(true);
  });

  it('gives the lawn its floor and the rear bed the rest, from one function', () => {
    expect(lawnViable(2.5, 4.8)).toBe(true);
    expect(lawnViable(2.4, 10)).toBe(false);
    expect(lawnViable(3, 3)).toBe(false); // 9 m² is a rug
    expect(LAWN_FLOOR).toEqual({ minDimension: 2.5, area: 12 });

    // 9 m deep, terrace 3.15: what is left after a minimum lawn becomes the rear bed.
    const T = terraceDepth(1, 9);
    expect(lawnEnd(1, 9, T) - lawnStart(1, 9, T)).toBeGreaterThanOrEqual(LAWN_FLOOR.minDimension);
    expect(rearBedDepth(1, 9, T)).toBeGreaterThanOrEqual(BED_MIN_DEPTH);
    // Never deeper than twice the border, however deep the garden. 2 × 2.2 since borders deepened.
    expect(rearBedDepth(1, 30, 3.6)).toBeCloseTo(4.4);
    // Never thinner than the sliver guard, however shallow.
    expect(rearBedDepth(1, 4, 3)).toBe(BED_MIN_DEPTH);
  });
});

describe('fitInSlot', () => {
  const frame = backFrame(house())!;
  const room = gardenRoom(plot, house(), frame, ['front', 'back', 'left', 'right']);
  const context = (obstacles: Point[][] = []): FitContext => ({
    frame,
    room,
    houseRing: geometryOutline({
      kind: 'rect',
      centre: { x: 10, y: 10 },
      width: 8,
      depth: 6,
      rotation: 0,
    }),
    boundary: plot,
    obstacles,
  });

  it('places at the anchor when it fits, aligned to the wall', () => {
    const geometry = fitInSlot(
      { kind: 'rect', width: 2.5, depth: 2 },
      { id: 's', kind: 'utility', anchor: { u: 5, v: 7 }, maxSize: { width: 3, depth: 3 } },
      context(),
    )!;
    expect(geometry.kind).toBe('rect');
    if (geometry.kind !== 'rect') return;
    expect(geometry.centre.x).toBeCloseTo(17);
    expect(geometry.centre.y).toBeCloseTo(2);
    expect(geometry.rotation).toBeCloseTo(0);
    expect(polygonContainsPolygon(room, geometryOutline(geometry))).toBe(true);
  });

  it('nudges past an obstacle rather than giving up', () => {
    const blocker = geometryOutline({
      kind: 'rect',
      centre: { x: 17, y: 2 },
      width: 1,
      depth: 1,
      rotation: 0,
    });
    const geometry = fitInSlot(
      { kind: 'rect', width: 2.5, depth: 2 },
      { id: 's', kind: 'utility', anchor: { u: 5, v: 7 }, maxSize: { width: 3, depth: 3 } },
      context([blocker]),
    )!;
    expect(geometry).not.toBeNull();
    expect(polygonContainsPolygon(room, geometryOutline(geometry))).toBe(true);
  });

  it('shrinks to the slot and refuses below six tenths', () => {
    const small = fitInSlot(
      { kind: 'rect', width: 4, depth: 4 },
      { id: 's', kind: 'far-room', anchor: { u: 5, v: 7 }, maxSize: { width: 3, depth: 3 } },
      context(),
    )!;
    if (small.kind === 'rect') expect(small.width).toBeLessThanOrEqual(3);

    // A 12 m square in a room 7 m deep cannot fit even at six tenths, so nothing is invented.
    const none = fitInSlot(
      { kind: 'rect', width: 12, depth: 12 },
      { id: 's', kind: 'far-room', anchor: { u: 3.5, v: 0 }, maxSize: { width: 12, depth: 12 } },
      context(),
    );
    expect(none).toBeNull();
  });

  it('refuses rather than shrink below the slot floor', () => {
    // A 4 m square sized into a 3 m slot is 3 m; a floor of 3.5 is already unmet, so no nudge is tried.
    const refused = fitInSlot(
      { kind: 'rect', width: 4, depth: 4 },
      {
        id: 's',
        kind: 'terrace-end',
        anchor: { u: 5, v: 7 },
        maxSize: { width: 3, depth: 3 },
        minSize: { width: 3.5, depth: 3.5 },
      },
      context(),
    );
    expect(refused).toBeNull();

    // The same slot with a floor it can meet fits, and never below that floor.
    const met = fitInSlot(
      { kind: 'rect', width: 4, depth: 4 },
      {
        id: 's',
        kind: 'terrace-end',
        anchor: { u: 5, v: 7 },
        maxSize: { width: 3, depth: 3 },
        minSize: { width: 2.8, depth: 2.8 },
      },
      context(),
    )!;
    expect(met).not.toBeNull();
    if (met.kind === 'rect') {
      expect(met.width).toBeGreaterThanOrEqual(2.8 - 1e-9);
      expect(met.depth).toBeGreaterThanOrEqual(2.8 - 1e-9);
    }

    // Without a floor the old six-tenths rule still applies.
    expect(floorScale({ kind: 'rect', width: 3, depth: 2 }, { width: 2, depth: 3 })).toBeCloseTo(1);
    expect(
      floorScale({ kind: 'rect', width: 3, depth: 2 }, { width: 1.5, depth: 2.4 }),
    ).toBeCloseTo(0.8);
    expect(floorScale({ kind: 'point', radius: 1 }, { width: 1, depth: 1 })).toBeCloseTo(0.5);
  });
});

describe('frontGarden', () => {
  it('runs a path from the front door to the street and keeps beds either side', () => {
    const front = house({
      openings: [
        {
          id: 'o2',
          wallId: 'w2',
          offsetAlongEdge: 4,
          width: 0.9,
          type: 'front-door',
          sillHeight: 0,
          floorLevel: 0,
          swing: 'inward',
        },
      ],
    });
    const frame = frontFrame(front)!;
    const room = gardenRoom(plot, front, frame, ['front', 'back', 'left', 'right']);
    const box = localBox(room, frame);
    const sketch = frontGarden(
      frame,
      box,
      [
        { x: 20, y: 16 },
        { x: 0, y: 16 },
      ],
      0.9,
    )!;

    expect(sketch.path[0]!.u).toBeCloseTo(0.05);
    expect(sketch.path[sketch.path.length - 1]!.u).toBeCloseTo(box.uMax - 0.05);
    expect(sketch.beds).toHaveLength(2);
    expect(sketch.hedges).toHaveLength(2);
  });

  it('gives up on a doorstep', () => {
    const frame = frontFrame(house())!;
    expect(
      frontGarden(frame, { uMin: 0, uMax: 2, vMin: -4, vMax: 4, polygon: [] }, null, 0.9),
    ).toBeNull();
  });
});

describe('roomBehind', () => {
  // An L in the frame: 12 m wide for the first 4 m out, then only the left 6 m for a further 8 m.
  const room: Room = {
    uMin: 0,
    uMax: 12,
    vMin: -6,
    vMax: 6,
    polygon: [
      { u: 0, v: -6 },
      { u: 0, v: 6 },
      { u: 4, v: 6 },
      { u: 4, v: 0 },
      { u: 12, v: 0 },
      { u: 12, v: -6 },
    ],
  };

  it('narrows to the deep limb behind the terrace', () => {
    const deep = roomBehind(room, 4.5);
    expect(deep.uMin).toBeCloseTo(4.5);
    expect(deep.uMax).toBeCloseTo(12);
    expect(deep.vMin).toBeCloseTo(-6);
    expect(deep.vMax).toBeCloseTo(0);
  });

  it('is the same box with a nearer edge when there is no outline', () => {
    const deep = roomBehind({ uMin: 0, uMax: 12, vMin: -6, vMax: 6 }, 3);
    expect(deep).toEqual({ uMin: 3, uMax: 12, vMin: -6, vMax: 6 });
  });
});
