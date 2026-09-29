import { describe, expect, it } from 'vitest';
import { rotatePoint } from '../../geometry/primitives.js';
import type { DesignElement } from '../concepts.js';
import { houseHeight } from '../heights.js';
import { rectangleHouse } from '../site.js';
import { SYMBOLS } from '../symbols.js';
import { localFrame, structureNeighbourhood, type LocalPoint } from './neighbourhood.js';

/** A 20 m square plot, corners v1..v4 clockwise from the top left. */
const VERTICES = [
  { id: 'v1', x: 0, y: 0 },
  { id: 'v2', x: 20, y: 0 },
  { id: 'v3', x: 20, y: 20 },
  { id: 'v4', x: 0, y: 20 },
];
const site = (over: Partial<Parameters<typeof structureNeighbourhood>[1]['site']> = {}) => ({
  vertices: VERTICES,
  boundaryStyles: [],
  house: null,
  ...over,
});

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 0 },
  ...over,
});

const rectElement = (
  id: string,
  category: DesignElement['category'],
  centre: { x: number; y: number },
  size: { width: number; depth: number },
  over: Partial<DesignElement> = {},
): DesignElement => ({
  id,
  category,
  role: 'feature',
  zone: 'back',
  shape: { kind: 'rect', centre, ...size, rotation: 0 },
  ...over,
});

const near = (a: LocalPoint, b: LocalPoint) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

describe('the local frame', () => {
  /** X along the width, Z towards the open front — the frame the 3D model is drawn in. */
  it('puts a thing along the width on X and a thing in front on Z, however it is turned', () => {
    for (const rotation of [0, 30, 210]) {
      const centre = { x: 10, y: 12 };
      const along = rotatePoint({ x: centre.x + 2, y: centre.y }, centre, rotation);
      const ahead = rotatePoint({ x: centre.x, y: centre.y + 3 }, centre, rotation);
      const tree = (id: string, at: { x: number; y: number }): DesignElement => ({
        id,
        category: 'planting-bed',
        role: 'feature',
        zone: 'back',
        symbol: 'tree-fruit',
        shape: { kind: 'point', at, radius: 1.5 },
      });
      const found = structureNeighbourhood(
        pergola({ shape: { kind: 'rect', centre, width: 3, depth: 3, rotation } }),
        { elements: [tree('along', along), tree('ahead', ahead)], site: site() },
      )!;
      near(found.plants.find((plant) => plant.id === 'along')!.at, { x: 2, z: 0 });
      near(found.plants.find((plant) => plant.id === 'ahead')!.at, { x: 0, z: 3 });
    }
  });

  it('turns a neighbouring structure by the difference in rotation', () => {
    const found = structureNeighbourhood(
      pergola({
        shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 30 },
      }),
      {
        elements: [
          pergola({
            id: 'g1',
            symbol: 'gazebo',
            shape: { kind: 'rect', centre: { x: 15, y: 12 }, width: 3, depth: 3, rotation: 30 },
          }),
        ],
        site: site(),
      },
    )!;
    expect(found.structures).toHaveLength(1);
    expect(found.structures[0]!.yaw).toBeCloseTo(0);
    expect(found.structures[0]!.structure.roof.kind).toBe('hipped');
  });

  it('maps a point there and back', () => {
    const frame = localFrame(
      pergola({
        shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 37 },
      }),
    )!;
    const plan = { x: 13.2, y: 9.1 };
    const back = frame.toPlan(frame.toLocal(plan));
    expect(back.x).toBeCloseTo(plan.x);
    expect(back.y).toBeCloseTo(plan.y);
  });

  it('is nothing for an element with no 3D editor', () => {
    expect(
      structureNeighbourhood(pergola({ symbol: 'shed' }), { elements: [], site: site() }),
    ).toBeNull();
  });
});

describe('what is included', () => {
  const lawn: DesignElement = {
    id: 'lawn',
    category: 'lawn',
    role: 'fill',
    fillKind: 'base',
    zone: 'back',
    material: 'standard-turf',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    },
  };

  it('cuts the ground to the window and keeps its stacking order', () => {
    const terrace = rectElement('terrace', 'paved-area', { x: 10, y: 9 }, { width: 6, depth: 3 });
    const found = structureNeighbourhood(
      pergola(),
      { elements: [lawn, terrace], site: site() },
      { reach: 2 },
    )!;

    expect(found.half).toBe(3.5);
    expect(found.surfaces.map((surface) => surface.id)).toEqual(['lawn', 'terrace']);
    expect(found.surfaces[0]!.layer).toBeLessThan(found.surfaces[1]!.layer);
    for (const point of found.surfaces[0]!.ring) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(3.5 + 1e-9);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(3.5 + 1e-9);
    }
  });

  it('leaves out itself, anything hidden, and anything well away', () => {
    const hidden = rectElement(
      'hidden',
      'structure',
      { x: 11, y: 12 },
      { width: 1, depth: 1 },
      { hidden: true },
    );
    const far = rectElement('far', 'structure', { x: 19, y: 1 }, { width: 1, depth: 1 });
    const found = structureNeighbourhood(
      pergola(),
      { elements: [pergola(), hidden, far], site: site() },
      { reach: 2 },
    )!;
    expect(found.solids).toEqual([]);
    expect(found.structures).toEqual([]);
  });

  it('keeps the table standing under it, at the table’s own height', () => {
    const table = rectElement(
      'table',
      'furniture',
      { x: 10, y: 12 },
      { width: 2.4, depth: 2.4 },
      {
        symbol: 'dining-set-4',
      },
    );
    const found = structureNeighbourhood(pergola(), { elements: [table], site: site() })!;
    // Standing inside, it is the interior the editor lets you move — not the surroundings.
    expect(found.solids).toEqual([]);
    expect(found.interior).toMatchObject([
      {
        id: 'table',
        kind: 'furniture',
        symbol: 'dining-set-4',
        height: SYMBOLS['dining-set-4'].height,
        base: 0,
      },
    ]);
  });

  it('builds the fence it is near, inside the plot, at its height, and not an open side', () => {
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 18, y: 12 }, width: 3, depth: 3, rotation: 0 },
    });
    const found = structureNeighbourhood(
      byFence,
      { elements: [], site: site({ boundaryStyles: [{ edgeVertexId: 'v1', kind: 'open' }] }) },
      { reach: 2 },
    )!;
    const walls = found.solids.filter((solid) => solid.kind === 'boundary');
    // The right-hand side (v2 → v3) is within reach; the top (v1 → v2) is open and not built.
    expect(walls.map((wall) => wall.id)).toEqual(['boundary-v2']);
    expect(walls[0]!.height).toBe(1.8);
    // Thickened inward: every corner is inside the plot, the fence line at local x = 2.
    for (const point of walls[0]!.ring) expect(point.x).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('brings the whole house when it is near, at its eaves height', () => {
    const house = rectangleHouse({ x: 10, y: 4 }, 8, 6);
    const found = structureNeighbourhood(
      pergola({
        shape: { kind: 'rect', centre: { x: 10, y: 9 }, width: 3, depth: 3, rotation: 0 },
      }),
      {
        elements: [],
        site: site({ house }),
      },
    )!;
    expect(found.house?.eaves).toBe(houseHeight(house));
    expect(found.house?.openings).toEqual([]);
    expect(found.house?.ring).toHaveLength(4);
    // Not cut: the far wall is 8 m behind, beyond a 2 m window.
    const reduced = structureNeighbourhood(
      pergola({
        shape: { kind: 'rect', centre: { x: 10, y: 9 }, width: 3, depth: 3, rotation: 0 },
      }),
      {
        elements: [],
        site: site({ house }),
      },
      { reach: 2 },
    )!;
    expect(Math.min(...reduced.house!.ring.map((point) => point.z))).toBeCloseTo(-8);
  });

  it('keeps a tree outside the window whose crown reaches into it', () => {
    const tree: DesignElement = {
      id: 'oak',
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      symbol: 'tree-deciduous',
      shape: { kind: 'point', at: { x: 16, y: 12 }, radius: 2.5 },
    };
    const found = structureNeighbourhood(
      pergola(),
      { elements: [tree], site: site() },
      { reach: 3 },
    )!;
    expect(found.plants).toMatchObject([{ id: 'oak', kind: 'tree', canopy: 2.5, height: 7 }]);
    expect(found.plants[0]!.trunk).toBeGreaterThan(0.15);
  });

  it('lowers everything by a raised structure’s own elevation', () => {
    const table = rectElement(
      'table',
      'furniture',
      { x: 10, y: 12 },
      { width: 2.4, depth: 2.4 },
      {
        symbol: 'dining-set-4',
        elevation: 0.45,
      },
    );
    // Reach far enough that the fence is in the window.
    const found = structureNeighbourhood(
      pergola({ elevation: 0.45 }),
      { elements: [lawn, table], site: site() },
      { reach: 9 },
    )!;
    expect(found.ground).toBeCloseTo(-0.45);
    expect(found.surfaces[0]!.y).toBeCloseTo(-0.45);
    expect(found.interior.find((solid) => solid.id === 'table')!.base).toBeCloseTo(0);
    const fences = found.solids.filter((solid) => solid.kind === 'boundary');
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) expect(fence.base).toBeCloseTo(-0.45);
  });
});

describe('what the 3D view needs to draw it well', () => {
  it('brings the house’s doors in the local frame, at their height, facing out', () => {
    const house = rectangleHouse({ x: 10, y: 4 }, 8, 6);
    const withDoor = {
      ...house,
      openings: [
        {
          id: 'o1',
          wallId: house.walls[2]!.id,
          offsetAlongEdge: 4,
          width: 2.4,
          type: 'patio-door' as const,
          sillHeight: 0,
          floorLevel: 0,
          swing: 'none' as const,
        },
      ],
    };
    const found = structureNeighbourhood(
      pergola({
        shape: { kind: 'rect', centre: { x: 10, y: 9 }, width: 3, depth: 3, rotation: 0 },
      }),
      { elements: [], site: site({ house: withDoor }) },
    )!;
    const [door] = found.house!.openings;
    expect(door).toMatchObject({ type: 'patio-door', bottom: 0, top: 2.1 });
    // The back wall is at plan y = 7, two metres behind the pergola's centre.
    expect(door!.a.z).toBeCloseTo(-2);
    expect(Math.abs(door!.a.x - door!.b.x)).toBeCloseTo(2.4);
    expect(door!.outward.z).toBeCloseTo(1);
  });

  it('keeps a tree’s species and a fence’s line', () => {
    const tree: DesignElement = {
      id: 'yew',
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      symbol: 'tree-evergreen',
      shape: { kind: 'point', at: { x: 12, y: 12 }, radius: 1.6 },
    };
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 18, y: 12 }, width: 3, depth: 3, rotation: 0 },
    });
    const found = structureNeighbourhood(
      byFence,
      { elements: [tree], site: site() },
      { reach: 7 },
    )!;
    expect(found.plants[0]!.symbol).toBe('tree-evergreen');
    const fence = found.solids.find((solid) => solid.id === 'boundary-v2')!;
    expect(fence.run!.start.x).toBeCloseTo(2);
    expect(fence.run!.inward.x).toBeCloseTo(-1);
  });
});
