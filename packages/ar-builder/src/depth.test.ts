import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planToGround, type Mesh, type SolidNode } from '@garden-studio/ar-contract';
import {
  BOUNDARY_BAYS,
  boundaryPolygon,
  edgingHeight,
  houseHeight,
  pointInPolygon,
  readPlanDocument,
  stepFlight,
  type DesignElement,
  type PlanDocument,
} from '@garden-studio/schema';
import { buildArScene } from './build.js';

const FIXTURES = join(__dirname, '../../../apps/web/scripts/fixtures');
const read = (name: string): PlanDocument =>
  readPlanDocument(JSON.parse(readFileSync(join(FIXTURES, `${name}.plan.json`), 'utf8')));
const suburban = read('suburban');

type V3 = [number, number, number];

function vertices(mesh: Mesh): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3)
    out.push([mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!]);
  return out;
}

function triangles(mesh: Mesh): V3[][] {
  const at = (i: number): V3 => [
    mesh.positions[i * 3]!,
    mesh.positions[i * 3 + 1]!,
    mesh.positions[i * 3 + 2]!,
  ];
  const out: V3[][] = [];
  for (let t = 0; t < mesh.indices.length; t += 3)
    out.push([at(mesh.indices[t]!), at(mesh.indices[t + 1]!), at(mesh.indices[t + 2]!)]);
  return out;
}

function normal([a, b, c]: V3[]): V3 {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
}

const solid = (
  scene: { nodes: SolidNode[] | unknown[] },
  predicate: (node: SolidNode) => boolean,
) => (scene.nodes as SolidNode[]).filter((node) => node.kind === 'solid' && predicate(node));

/* ------------------------------------------------------------------ a bare plot to build on */

const plot = [
  { x: 0, y: 0, id: 'a' },
  { x: 20, y: 0, id: 'b' },
  { x: 20, y: 20, id: 'c' },
  { x: 0, y: 20, id: 'd' },
];

function site(extra: Partial<PlanDocument['site']> = {}): PlanDocument['site'] {
  return {
    ...suburban.site,
    vertices: plot,
    house: null,
    gates: [],
    streetEdgeVertexId: null,
    boundaryStyles: [],
    ...extra,
  };
}

const rect = (
  id: string,
  category: DesignElement['category'],
  x: number,
  y: number,
  w: number,
  d: number,
  extra: Partial<DesignElement> = {},
): DesignElement => ({
  id,
  category,
  role: 'feature',
  shape: { kind: 'rect', centre: { x, y }, width: w, depth: d, rotation: 0 },
  zone: 'back',
  material: category === 'lawn' ? 'standard-turf' : 'porcelain',
  ...extra,
});

const build = (elements: DesignElement[], over: Partial<PlanDocument['site']> = {}) =>
  buildArScene(
    {
      site: site(over),
      elements,
      source: { projectId: null, projectName: 't', revision: null, documentVersion: null },
    },
    { generatedAt: '2026-09-30T00:00:00.000Z' },
  );

/* ------------------------------------------------------------------ the house */

describe('the house', () => {
  const { scene } = buildArScene(
    {
      site: suburban.site,
      elements: [],
      source: { projectId: null, projectName: 's', revision: null, documentVersion: 4 },
    },
    { generatedAt: 'x' },
  );
  const house = solid(scene, (node) => node.id === 'house')[0]!;

  it('has walls to the eaves and a roof above them', () => {
    expect(house.parts.map((part) => part.material)).toEqual([
      'house:walls',
      `roof:${suburban.site.house!.roofMaterial ?? 'slate'}`,
    ]);
    const eaves = houseHeight(suburban.site.house);
    const roof = vertices(house.parts[1]!.mesh);
    expect(Math.min(...roof.map((v) => v[1]))).toBeCloseTo(eaves, 6);
    expect(Math.max(...roof.map((v) => v[1]))).toBeGreaterThan(eaves + 1);
  });

  it('faces every roof triangle up', () => {
    for (const triangle of triangles(house.parts[1]!.mesh))
      expect(normal(triangle)[1]).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ boundaries */

describe('boundaries', () => {
  it('builds every side as a fence, inside the plot, with its posts at the bay spacing', () => {
    const { scene } = build([]);
    const fences = solid(scene, (node) => node.category === 'boundary');
    expect(fences).toHaveLength(4);
    const ring = boundaryPolygon(site()).map((point) =>
      planToGround(point, scene.frame.origin.plan),
    );
    const inside = (x: number, z: number) =>
      pointInPolygon(
        { x, y: z },
        ring.map(([px, pz]) => ({ x: px, y: pz })),
      ) ||
      ring.some(([px, pz], i) => {
        const [qx, qz] = ring[(i + 1) % ring.length]!;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / ((qx - px) ** 2 + (qz - pz) ** 2),
          ),
        );
        return Math.hypot(x - (px + t * (qx - px)), z - (pz + t * (qz - pz))) < 0.07;
      });
    for (const fence of fences) {
      // Built on the plot's side of the line: the inward direction was probed, not assumed.
      for (const [x, , z] of vertices(fence.parts[0]!.mesh)) expect(inside(x, z)).toBe(true);
      // A 20 m side at 1.8 m bays is twelve bays, so thirteen posts of eight corners each.
      expect(vertices(fence.parts[1]!.mesh).length / 24).toBe(
        Math.ceil(20 / BOUNDARY_BAYS.fence!) + 1,
      );
    }
  });

  it('builds nothing along an open side, and each kind as itself', () => {
    const { scene } = build([], {
      boundaryStyles: [
        { edgeVertexId: 'a', kind: 'open' },
        { edgeVertexId: 'b', kind: 'wall' },
        { edgeVertexId: 'c', kind: 'hedge' },
        { edgeVertexId: 'd', kind: 'railing' },
      ],
    });
    const byEdge = new Map(
      solid(scene, (node) => node.category === 'boundary').map((node) => [node.sourceId, node]),
    );
    expect(byEdge.has('boundary:a')).toBe(false);
    // A wall: its body, its piers and a coping.
    expect(byEdge.get('boundary:b')!.parts.map((part) => part.material)).toEqual([
      'boundary:wall',
      'boundary:wall:detail',
      'boundary:wall:cap',
    ]);
    expect(byEdge.get('boundary:c')!.parts).toHaveLength(1);
    const railing = byEdge.get('boundary:d')!;
    expect(Math.max(...vertices(railing.parts[0]!.mesh).map((v) => v[1]))).toBeCloseTo(1.1, 6);
  });

  it('stands a proposed fence where the design puts it, as that element', () => {
    const screen: DesignElement = {
      id: 'screen-1',
      category: 'enclosure',
      role: 'feature',
      zone: 'back',
      enclosure: { kind: 'screen' },
      material: 'softwood',
      shape: {
        kind: 'polyline',
        points: [
          { x: 5, y: 10 },
          { x: 15, y: 10 },
        ],
        width: 0.08,
      },
    };
    const { scene, skipped } = build([screen]);
    const node = solid(scene, (candidate) => candidate.sourceId === 'screen-1')[0]!;
    expect(node.category).toBe('boundary');
    expect(node.parts.map((part) => part.material)).toContain('boundary:screen:cap');
    expect(skipped.map((entry) => entry.elementId)).not.toContain('screen-1');
  });

  it('names an opening in the boundary rather than drawing it, and lays a proposed kerb as a course', () => {
    const opening: DesignElement = {
      id: 'gap',
      category: 'enclosure',
      role: 'feature',
      zone: 'back',
      enclosure: { kind: 'open' },
      shape: {
        kind: 'polyline',
        points: [
          { x: 0, y: 5 },
          { x: 0, y: 8 },
        ],
        width: 0.1,
      },
    };
    const kerb: DesignElement = {
      id: 'kerb-1',
      category: 'enclosure',
      role: 'feature',
      zone: 'back',
      enclosure: { kind: 'kerb' },
      shape: {
        kind: 'polyline',
        points: [
          { x: 4, y: 4 },
          { x: 10, y: 4 },
        ],
        width: 0.15,
      },
    };
    const { scene, skipped } = build([opening, kerb]);
    expect(skipped).toContainEqual({
      elementId: 'gap',
      reason: 'an opening in the boundary, which builds nothing',
    });
    const course = solid(scene, (node) => node.sourceId === 'kerb-1')[0]!;
    expect(course.category).toBe('edging');
    expect(Math.max(...vertices(course.parts[0]!.mesh).map((v) => v[1]))).toBeCloseTo(0.1, 6);
  });
});

/* ------------------------------------------------------------------ levels */

describe('levels', () => {
  it('holds a raised terrace up with a face from the ground to just proud of its top', () => {
    const { scene } = build([
      rect('lawn', 'lawn', 10, 10, 18, 18),
      rect('terrace', 'paved-area', 10, 6, 6, 3, { elevation: 0.34 }),
    ]);
    const face = solid(scene, (node) => node.id === 'terrace:retaining')[0]!;
    const ys = vertices(face.parts[0]!.mesh).map((v) => v[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(0.34 + 0.015, 9);
    // The terrace itself stands at its elevation.
    const terrace = scene.nodes.find((node) => node.id === 'terrace')!;
    expect(terrace.kind === 'surface' && terrace.y).toBe(0.34);
  });

  it('holds the lawn back round a sunken area, from its floor up to the ground', () => {
    const { scene } = build([
      rect('lawn', 'lawn', 10, 10, 18, 18),
      rect('pit', 'paved-area', 10, 10, 4, 4, { elevation: -0.3 }),
    ]);
    const ys = vertices(solid(scene, (node) => node.id === 'pit:retaining')[0]!.parts[0]!.mesh).map(
      (v) => v[1],
    );
    expect(Math.min(...ys)).toBeCloseTo(-0.3, 9);
    expect(Math.max(...ys)).toBeCloseTo(0.015, 9);
  });

  it('builds a flight as its risers, climbing to the terrace it serves — whichever side that is', () => {
    for (const side of [1, -1] as const) {
      // The terrace north or south of the flight, which is flush against it.
      const terrace = rect('terrace', 'paved-area', 10, 10 - side * 2.5, 6, 3, { elevation: 0.34 });
      const risers = stepFlight(0.34)!.risers;
      const flight = rect(
        'steps',
        'structure',
        10,
        10 - side * 2.5 + side * (1.5 + (risers * 0.35) / 2),
        1.2,
        risers * 0.35,
        {
          symbol: 'steps',
          elevation: 0.34,
          material: 'stone-pavers',
        },
      );
      const { scene } = build([terrace, flight]);
      const node = solid(scene, (candidate) => candidate.id === 'steps')[0]!;
      expect(node.category).toBe('steps');
      const points = vertices(node.parts[0]!.mesh);
      expect(points.length / 24).toBe(risers);
      expect(Math.max(...points.map((v) => v[1]))).toBeCloseTo(0.34, 9);
      // The top of the flight is at the terrace's end.
      const origin = scene.frame.origin.plan;
      const terraceZ = 10 - side * 2.5 - origin.y;
      const flightZ = flight.shape.kind === 'rect' ? flight.shape.centre.y - origin.y : 0;
      const topmost = points.filter((v) => Math.abs(v[1] - 0.34) < 1e-9);
      const meanTopZ = topmost.reduce((sum, v) => sum + v[2], 0) / topmost.length;
      expect(Math.abs(meanTopZ - terraceZ)).toBeLessThan(Math.abs(flightZ - terraceZ));
    }
  });
});

/* ------------------------------------------------------------------ edging and floors */

describe('edging', () => {
  it('stands a brick course along the stretch a bed asked for, at the brick’s own height', () => {
    const bed = rect('bed', 'planting-bed', 10, 10, 6, 3, {
      material: 'mixed-border',
      edges: {
        mode: 'custom',
        runs: [
          {
            id: 'r1',
            side: 0,
            anchor: 'start',
            from: 0,
            to: 6,
            treatment: 'brick',
            source: 'user',
          },
        ],
      },
    });
    const { scene } = build([rect('lawn', 'lawn', 10, 10, 18, 18), bed]);
    const course = solid(scene, (node) => node.id === 'bed:edging')[0]!;
    expect(course.parts[0]!.material).toBe('material:brick-edging');
    expect(Math.max(...vertices(course.parts[0]!.mesh).map((v) => v[1]))).toBeCloseTo(
      edgingHeight('brick-edging'),
      9,
    );
  });
});

describe('structure floors', () => {
  it('lays a pergola’s floor as ground in its footprint, belonging to the pergola', () => {
    const pergola = rect('pergola', 'structure', 10, 10, 3, 3, {
      symbol: 'pergola',
      material: 'softwood',
      structure: { floor: 'stone-pavers' },
    });
    const { scene } = build([rect('lawn', 'lawn', 10, 10, 18, 18), pergola]);
    const floor = scene.nodes.find(
      (node) => node.kind === 'surface' && node.sourceId === 'pergola',
    );
    expect(floor?.kind === 'surface' && floor.material).toBe('material:stone-pavers');
  });
});

/* ------------------------------------------------------------------ contract 0.0.2 */

describe('what the scene now says about itself', () => {
  const { scene } = buildArScene(
    {
      site: suburban.site,
      elements: suburban.layout.elements,
      source: { projectId: null, projectName: 's', revision: null, documentVersion: 4 },
    },
    { generatedAt: 'x' },
  );

  it('carries the house’s doors and windows, with the garden door at the origin', () => {
    const house = solid(scene, (node) => node.id === 'house')[0]!;
    const door = house.openings?.find(
      (opening) => opening.kind === 'patio-door' || opening.kind === 'back-door',
    );
    expect(door).toBeDefined();
    // The origin is the foot of the garden door, which is the middle of its span.
    expect(Math.hypot((door!.a[0] + door!.b[0]) / 2, (door!.a[1] + door!.b[1]) / 2)).toBeLessThan(
      1e-6,
    );
    expect(door!.top).toBeGreaterThan(door!.bottom + 1.8);
    // Out into the garden.
    const [ox, oz] = scene.frame.houseOutward!;
    expect(door!.outward[0] * ox + door!.outward[1] * oz).toBeGreaterThan(0.7);
  });

  it('measures every solid’s UVs along its faces and leaves the ground in world XZ', () => {
    for (const node of scene.nodes) {
      if (node.kind === 'solid') for (const part of node.parts) expect(part.mesh.uv).toBe('face');
      if (node.kind === 'surface') expect(node.mesh.uv).toBeUndefined();
    }
  });

  it('gives every plant a tone, and names a mix’s species', () => {
    const plants = scene.nodes.filter((node) => node.kind === 'plants');
    expect(plants.length).toBeGreaterThan(0);
    for (const node of plants) {
      if (node.kind !== 'plants') continue;
      for (const instance of node.instances) expect(instance.tone).toBeGreaterThanOrEqual(0);
    }
    const bed = rect('mix', 'planting-bed', 10, 10, 6, 3, { material: 'mix-shade-woodland' });
    const { scene: mixed } = build([bed]);
    const species = mixed.nodes.flatMap((node) =>
      node.kind === 'plants' && node.species ? [node.species] : [],
    );
    expect(species.length).toBeGreaterThan(1);
    expect(new Set(species).size).toBe(species.length);
  });

  it('names a tree’s species where the plan does', () => {
    const tree: DesignElement = {
      id: 'birch',
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      symbol: 'tree-multistem',
      plantId: 'betula-utilis',
      shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 2 },
    };
    const model = build([tree]).scene.nodes.find((node) => node.id === 'birch');
    expect(model?.kind === 'model' && model.species).toBe('betula-utilis');
  });
});

describe('hedges', () => {
  it('marks a hedge boundary as a hedge, on its own band, and nothing else', () => {
    const { scene } = build([], { boundaryStyles: [{ edgeVertexId: 'a', kind: 'hedge' }] });
    const boundaries = solid(scene, (node) => node.category === 'boundary');
    const hedge = boundaries.find((node) => node.sourceId === 'boundary:a')!;
    expect(hedge.hedge?.height).toBeCloseTo(1.9, 9);
    expect(hedge.hedge?.outline).toHaveLength(4);
    for (const node of boundaries) if (node !== hedge) expect(node.hedge).toBeUndefined();
  });

  it('stands a hedging bed as a hedge rather than laying it as bare ground', () => {
    const bed = rect('yew', 'planting-bed', 10, 10, 6, 0.8, { material: 'hedging', height: 1.2 });
    const { scene } = build([bed]);
    const node = solid(scene, (candidate) => candidate.id === 'yew:hedge')[0]!;
    expect(node.hedge).toMatchObject({ base: 0, height: 1.2 });
    expect(node.parts[0]!.material).toBe('foliage:hedging');
  });
});
