import { describe, expect, it } from 'vitest';
import {
  geometryOutline,
  pointInPolygon,
  polygonArea,
  polygonContainsPolygon,
  rectangleHouse,
  type HouseFootprint,
  type Point,
} from '@garden-studio/schema';
import { assignSlots } from './assign.js';
import { fitInSlot, type FitContext } from './fit.js';
import { backFrame, frontFrame, gardenRoom, localBox, sideReturn } from './frame.js';
import { frontGarden } from './front.js';
import {
  behindTerrace,
  isCourtyard,
  roomBehind,
  terraceRect,
  type Room,
  type SketchRequest,
} from './sketch.js';
import { recommendedIndex, TEMPLATES, templateFor } from './templates/index.js';

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
    expect(terrace.u1).toBeLessThanOrEqual(0.45 * 7 + 1e-9);
  });

  it('calls a shallow room a courtyard', () => {
    expect(isCourtyard(1, 4)).toBe(true);
    expect(isCourtyard(1, 12)).toBe(false);
  });
});

describe('the templates', () => {
  const room: Room = { uMin: 0, uMax: 12, vMin: -9, vMax: 9 };

  it('all give a terrace, a lawn and the slots the brief needs', () => {
    for (const template of ['rectilinear', 'curved', 'formal'] as const) {
      const sketch = TEMPLATES[template](request(), room);
      expect(sketch.terrace).not.toBeNull();
      expect(sketch.lawn).not.toBeNull();
      expect(sketch.courtyard).toBe(false);
      expect(sketch.slots.map((slot) => slot.kind)).toContain('utility');
      expect(sketch.slots.map((slot) => slot.kind)).toContain('far-room');
    }
  });

  it('keeps the lawn inside the room and off the terrace', () => {
    for (const template of ['rectilinear', 'curved', 'formal'] as const) {
      const sketch = TEMPLATES[template](request(), room);
      const terrace = sketch.terrace!;
      const points =
        sketch.lawn!.kind === 'rect'
          ? [
              { u: sketch.lawn!.rect.u0, v: sketch.lawn!.rect.v0 },
              { u: sketch.lawn!.rect.u1, v: sketch.lawn!.rect.v1 },
            ]
          : sketch.lawn!.points;
      for (const point of points) {
        expect(point.u).toBeGreaterThanOrEqual(terrace.u1 - 1e-9);
        expect(point.u).toBeLessThanOrEqual(room.uMax);
        expect(point.v).toBeGreaterThanOrEqual(room.vMin);
        expect(point.v).toBeLessThanOrEqual(room.vMax);
      }
    }
  });

  it('puts the utility corner on the gate side and the far room on the other', () => {
    const sketch = TEMPLATES.rectilinear(request({ gateSide: 'left' }), room);
    const utility = sketch.slots.find((slot) => slot.kind === 'utility')!;
    const far = sketch.slots.find((slot) => slot.kind === 'far-room')!;
    expect(utility.anchor.v).toBeLessThan(0);
    expect(far.anchor.v).toBeGreaterThan(0);
  });

  it('mirrors the formal plan about the door axis', () => {
    const sketch = TEMPLATES.formal(request(), room);
    expect(sketch.terrace!.v0).toBeCloseTo(-sketch.terrace!.v1);
    expect(sketch.lawn!.kind === 'rect' && sketch.lawn!.rect.v0).toBeCloseTo(
      -(sketch.lawn!.kind === 'rect' ? sketch.lawn!.rect.v1 : 0),
    );
    const utility = sketch.slots.find((slot) => slot.id === 'utility')!;
    const mirror = sketch.slots.find((slot) => slot.id === 'utility-2')!;
    expect(utility.anchor.v).toBeCloseTo(-mirror.anchor.v);
    expect(utility.anchor.u).toBeCloseTo(mirror.anchor.u);
    expect(sketch.axisPath).not.toBeNull();
  });

  it('goes courtyard on a shallow room', () => {
    const sketch = TEMPLATES.rectilinear(request(), { uMin: 0, uMax: 4, vMin: -4, vMax: 4 });
    expect(sketch.courtyard).toBe(true);
    expect(sketch.lawn).toBeNull();
    expect(sketch.paths).toEqual([]);
  });

  it('recommends the style its own template', () => {
    expect(templateFor(recommendedIndex('modern'))).toBe('rectilinear');
    expect(templateFor(recommendedIndex('cottage'))).toBe('curved');
    expect(templateFor(recommendedIndex('formal'))).toBe('formal');
    expect(templateFor(recommendedIndex(null))).toBe('rectilinear');
  });
});

describe('assignSlots', () => {
  it('hands each feature its preferred slot and never one twice', () => {
    const sketch = TEMPLATES.rectilinear(request(), { uMin: 0, uMax: 12, vMin: -9, vMax: 9 });
    const { assigned, unassigned } = assignSlots(sketch, [
      'pergola',
      'firePit',
      'storage',
      'play',
      'water',
    ]);
    const byFeature = new Map(assigned.map((entry) => [entry.feature, entry.slotId]));
    expect(byFeature.get('pergola')).toBe('terrace-end');
    expect(byFeature.get('firePit')).toBe('far-room');
    expect(byFeature.get('storage')).toBe('utility');
    expect(byFeature.get('play')).toBe('lawn-far');
    expect(byFeature.get('water')).toBe('terrace-corner');
    expect(unassigned).toEqual([]);
    expect(new Set(assigned.map((entry) => entry.slotId)).size).toBe(assigned.length);
  });

  it('puts water on the axis of a formal plan', () => {
    const sketch = TEMPLATES.formal(request(), { uMin: 0, uMax: 12, vMin: -9, vMax: 9 });
    const { assigned } = assignSlots(sketch, ['water']);
    expect(assigned[0]?.slotId).toBe('axis-end');
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

  it('sizes the kidney lawn on the deep limb, not the whole L', () => {
    const sketch = TEMPLATES.curved(request({ style: 'cottage' }), room);
    expect(sketch.lawn?.kind).toBe('polygon');
    if (sketch.lawn?.kind !== 'polygon') return;
    for (const point of sketch.lawn.points) {
      expect(point.v).toBeLessThan(0.01);
      expect(point.u).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('behindTerrace', () => {
  it('centres a slot in the strip behind the terrace and shrinks it to fit', () => {
    const roomy = behindTerrace(4, 14, 4);
    expect(roomy.depth).toBe(4);
    expect(roomy.u + roomy.depth / 2).toBeLessThanOrEqual(14);
    expect(roomy.u - roomy.depth / 2).toBeGreaterThan(4);

    const tight = behindTerrace(4, 7, 4);
    expect(tight.depth).toBeCloseTo(2.6);
    expect(tight.u - tight.depth / 2).toBeGreaterThanOrEqual(4);
  });
});

describe('the utility notch', () => {
  it('cuts the shed corner out of the lawn on the gate side, and only when a shed is wanted', () => {
    const room: Room = { uMin: 0, uMax: 16, vMin: -9, vMax: 9 };
    const withShed = TEMPLATES.rectilinear(request({ scale: 1.4 }), room);
    const without = TEMPLATES.rectilinear(
      request({ scale: 1.4, features: ['seating', 'play', 'firePit'] }),
      room,
    );

    expect(without.lawn?.kind).toBe('rect');
    expect(withShed.lawn?.kind).toBe('polygon');
    if (withShed.lawn?.kind !== 'polygon') return;
    expect(withShed.lawn.points).toHaveLength(6);

    // The shed's slot lies wholly outside the lawn polygon.
    const utility = withShed.slots.find((slot) => slot.id === 'utility')!;
    const corners = [
      {
        u: utility.anchor.u - utility.maxSize.depth / 2,
        v: utility.anchor.v - utility.maxSize.width / 2,
      },
      {
        u: utility.anchor.u + utility.maxSize.depth / 2,
        v: utility.anchor.v + utility.maxSize.width / 2,
      },
    ];
    const lawn = withShed.lawn.points.map(({ u, v }) => ({ x: u, y: v }));
    for (const corner of corners) {
      expect(pointInPolygon({ x: corner.u, y: corner.v }, lawn)).toBe(false);
    }
    // And the lawn still reaches the back border on the far side.
    expect(Math.max(...withShed.lawn.points.map((p) => p.u))).toBeCloseTo(16 - 2.1, 1);
  });
});
