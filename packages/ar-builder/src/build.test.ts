import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { describe, expect, it } from 'vitest';
import {
  planToGround,
  readARScene,
  type ARScene,
  type Mesh,
  type SurfaceNode,
  type Vec2,
} from '@garden-studio/ar-contract';
import {
  boundaryPolygon,
  housePolygon,
  pointInPolygon,
  readPlanDocument,
  rectToPolygon,
  type DesignElement,
  type PlanDocument,
} from '@garden-studio/schema';
import { buildArScene, rankOf } from './build.js';
import { northOf } from './frame.js';
import type { ArSceneInput } from './types.js';

const FIXTURES = join(__dirname, '../../../apps/web/scripts/fixtures');
const GENERATED_AT = '2026-09-30T00:00:00.000Z';

const fixtures: [string, PlanDocument][] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.plan.json'))
  .sort()
  .map((file) => [file, readPlanDocument(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')))]);

const inputOf = (document: PlanDocument): ArSceneInput => ({
  site: document.site,
  elements: document.layout.elements,
  source: {
    projectId: null,
    projectName: 'fixture',
    revision: null,
    documentVersion: document.version,
  },
});

const build = (document: PlanDocument, plants: 'phone' | 'desktop' = 'desktop') =>
  buildArScene(inputOf(document), { plants, generatedAt: GENERATED_AT });

/* ------------------------------------------------------------------ helpers */

function triangles(mesh: Mesh): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  const at = (i: number): [number, number, number] => [
    mesh.positions[i * 3]!,
    mesh.positions[i * 3 + 1]!,
    mesh.positions[i * 3 + 2]!,
  ];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    out.push([at(mesh.indices[t]!), at(mesh.indices[t + 1]!), at(mesh.indices[t + 2]!)]);
  }
  return out;
}

/** The face normal's y from the winding alone. */
function normalY([a, b, c]: [number, number, number][]): number {
  const ux = b[0] - a[0];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vz = c[2] - a[2];
  return uz * vx - ux * vz;
}

function triangleArea(triangle: [number, number, number][]): number {
  return Math.abs(normalY(triangle)) / 2;
}

function meshArea(mesh: Mesh): number {
  return triangles(mesh).reduce((sum, triangle) => sum + triangleArea(triangle), 0);
}

function insideTriangle(p: Vec2, [a, b, c]: [number, number, number][]): boolean {
  const sign = (p1: Vec2, p2: [number, number, number], p3: [number, number, number]) =>
    (p1[0] - p3[0]) * (p2[2] - p3[2]) - (p2[0] - p3[0]) * (p1[1] - p3[2]);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const eps = 1e-9;
  return (d1 > eps && d2 > eps && d3 > eps) || (d1 < -eps && d2 < -eps && d3 < -eps);
}

const surfacesOf = (scene: ARScene) =>
  scene.nodes.filter((node): node is SurfaceNode => node.kind === 'surface');

/* ------------------------------------------------------------------ every fixture */

describe.each(fixtures)('%s', (_file, document) => {
  const { scene, skipped, warnings } = build(document);

  it('is a scene the phone can read', () => {
    expect(() => readARScene(JSON.parse(JSON.stringify(scene)))).not.toThrow();
    expect(warnings).toEqual([]);
  });

  it('draws or names every visible element, and never both', () => {
    const visible = document.layout.elements
      .filter((element) => !element.hidden)
      .map((element) => element.id);
    const drawn = new Set(scene.nodes.map((node) => node.sourceId));
    const named = new Set(skipped.map((entry) => entry.elementId));
    for (const id of visible) expect(drawn.has(id) || named.has(id), id).toBe(true);
    for (const id of named) expect(drawn.has(id), id).toBe(false);
  });

  it('faces every ground triangle up', () => {
    for (const surface of surfacesOf(scene)) {
      for (const triangle of triangles(surface.mesh)) {
        if (triangleArea(triangle) > 1e-9) expect(normalY(triangle), surface.id).toBeGreaterThan(0);
      }
    }
  });

  it('never lays two surfaces over each other', () => {
    const surfaces = surfacesOf(scene).map((surface) => ({
      surface,
      triangles: triangles(surface.mesh).filter((triangle) => triangleArea(triangle) > 1e-6),
    }));
    for (const { surface, triangles: own } of surfaces) {
      for (const triangle of own) {
        const probe: Vec2 = [
          (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
          (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3,
        ];
        for (const other of surfaces) {
          if (other.surface === surface) continue;
          const hit = other.triangles.some((candidate) => insideTriangle(probe, candidate));
          expect(hit, `${surface.id} under ${other.surface.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps all the ground it was given: the cut surfaces add up to the union of the outlines', () => {
    // Snapped to the builder's own micrometre grid, which is also what keeps the union from throwing.
    const snap = (ring: Vec2[]): Vec2[] =>
      ring.map(([x, z]) => [Math.round(x * 1e6) / 1e6, Math.round(z * 1e6) / 1e6]);
    const [first, ...rest] = surfacesOf(scene).map((surface): Polygon => [snap(surface.outline)]);
    const union = first ? polygonClipping.union(first, ...rest) : [];
    const unionArea = union.reduce(
      (sum, polygon) =>
        sum +
        polygon.reduce(
          (area, ring, index) => area + ((index === 0 ? 1 : -1) * Math.abs(shoelace(ring))) / 2,
          0,
        ),
      0,
    );
    const drawnArea = surfacesOf(scene).reduce((sum, surface) => sum + meshArea(surface.mesh), 0);
    // Half a square centimetre over a whole garden: the snapping moves areas by about 1e-6 m².
    expect(Math.abs(drawnArea - unionArea)).toBeLessThan(5e-5);
  });

  it('keeps everything on the plot or in the house', () => {
    const origin = scene.frame.origin.plan;
    const plot = boundaryPolygon(document.site).map((point) => planToGround(point, origin));
    const house = document.site.house
      ? housePolygon(document.site.house).map((point) => planToGround(point, origin))
      : [];
    const inside = (x: number, z: number) => {
      const point = { x, y: z };
      const onPlot = pointInPolygon(
        point,
        plot.map(([px, pz]) => ({ x: px, y: pz })),
      );
      const inHouse =
        house.length > 0 &&
        pointInPolygon(
          point,
          house.map(([px, pz]) => ({ x: px, y: pz })),
        );
      return (
        onPlot || inHouse || nearRing(point, plot) || (house.length > 0 && nearRing(point, house))
      );
    };
    for (const node of scene.nodes) {
      if (node.kind === 'surface')
        for (const [x, z] of node.outline) expect(inside(x, z), node.id).toBe(true);
      if (node.kind === 'model')
        expect(inside(node.position[0], node.position[2]), node.id).toBe(true);
      if (node.kind === 'plants')
        for (const { at } of node.instances) expect(inside(at[0], at[2]), node.id).toBe(true);
    }
  });

  it('is the same scene every time', () => {
    expect(build(document).scene).toEqual(scene);
  });

  it('gives the phone a subset of the desktop plants, within its budget', () => {
    const phone = build(document, 'phone').scene;
    const key = (node: ARScene['nodes'][number]) =>
      node.kind === 'plants'
        ? node.instances.map((instance) => `${node.id}@${instance.at.join(',')}`)
        : [];
    const desktopPlants = new Set(scene.nodes.flatMap(key));
    const phonePlants = phone.nodes.flatMap(key);
    expect(phonePlants.length).toBeLessThanOrEqual(300);
    expect(desktopPlants.size).toBeLessThanOrEqual(4000);
    for (const plant of phonePlants) expect(desktopPlants.has(plant)).toBe(true);
  });

  it('puts the origin on the ground at the garden door where there is one', () => {
    const door = (document.site.house?.openings ?? []).some(
      (opening) =>
        (opening.type === 'patio-door' || opening.type === 'back-door') && opening.floorLevel === 0,
    );
    if (door) expect(scene.frame.origin.kind).toBe('garden-door');
    expect(scene.referencePoints.length).toBeGreaterThan(0);
  });
});

function shoelace(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    sum += x1 * z2 - x2 * z1;
  }
  return sum;
}

function nearRing(point: { x: number; y: number }, ring: Vec2[], tolerance = 0.05): boolean {
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - ax) * dx + (point.y - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    if (Math.hypot(point.x - (ax + t * dx), point.y - (az + t * dz)) <= tolerance) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ the cut, one case at a time */

const plot = [
  { x: 0, y: 0, id: 'a' },
  { x: 20, y: 0, id: 'b' },
  { x: 20, y: 20, id: 'c' },
  { x: 0, y: 20, id: 'd' },
];

function site(): PlanDocument['site'] {
  const [, document] = fixtures[0]!;
  return { ...document.site, vertices: plot, house: null, gates: [], streetEdgeVertexId: null };
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
  material: category === 'lawn' ? 'lawn' : 'porcelain',
  ...extra,
});

const scene = (elements: DesignElement[]) =>
  buildArScene(
    {
      site: site(),
      elements,
      source: { projectId: null, projectName: 't', revision: null, documentVersion: null },
    },
    { generatedAt: GENERATED_AT },
  );

describe('the ground cut', () => {
  it('leaves a lawn with a hole where a patio stands in it', () => {
    const { scene: built } = scene([
      rect('lawn', 'lawn', 10, 10, 10, 10),
      rect('patio', 'paved-area', 10, 10, 2, 2),
    ]);
    const [lawn, patio] = surfacesOf(built);
    expect(meshArea(lawn!.mesh)).toBeCloseTo(96, 9);
    expect(meshArea(patio!.mesh)).toBeCloseTo(4, 9);
    // The hole is real: the middle of the patio is not lawn.
    expect(triangles(lawn!.mesh).some((triangle) => insideTriangle([0, 0], triangle))).toBe(false);
  });

  it('loses nothing where two patios only share an edge', () => {
    const { scene: built } = scene([
      rect('a', 'paved-area', 5, 5, 4, 4),
      rect('b', 'paved-area', 9, 5, 4, 4),
    ]);
    for (const surface of surfacesOf(built)) expect(meshArea(surface.mesh)).toBeCloseTo(16, 9);
  });

  it('names a surface wholly covered by what is over it rather than emitting an empty one', () => {
    const { scene: built, skipped } = scene([
      rect('under', 'lawn', 10, 10, 2, 2),
      rect('over', 'paved-area', 10, 10, 4, 4),
    ]);
    expect(surfacesOf(built).map((surface) => surface.id)).toEqual(['over']);
    expect(skipped).toEqual([
      { elementId: 'under', reason: 'wholly covered by what is drawn over it' },
    ]);
  });

  it('winds a surface up whichever way its outline runs', () => {
    const points = [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 5 },
      { x: 2, y: 5 },
    ];
    for (const ring of [points, [...points].reverse()]) {
      const { scene: built } = scene([
        {
          ...rect('p', 'paved-area', 0, 0, 1, 1),
          shape: { kind: 'polygon', points: ring, cornerRadius: 0 },
        },
      ]);
      for (const triangle of triangles(surfacesOf(built)[0]!.mesh))
        expect(normalY(triangle)).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ coordinates */

describe('placement', () => {
  for (const rotation of [0, 30, 45, 90, 135, 180, 270, 315]) {
    it(`lands a patio turned ${rotation}° exactly on its plan corners, not mirrored`, () => {
      const patio = rect('p', 'paved-area', 10, 10, 6, 3, {
        shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 6, depth: 3, rotation },
      });
      const { scene: built } = scene([patio]);
      const origin = built.frame.origin.plan;
      const expected = rectToPolygon({
        centre: { x: 10, y: 10 },
        width: 6,
        depth: 3,
        rotation,
      }).map((point) => planToGround(point, origin));
      const surface = surfacesOf(built)[0]!;
      for (const [x, z] of expected) {
        const found = triangles(surface.mesh).some((triangle) =>
          triangle.some(([px, , pz]) => Math.abs(px - x) < 1e-9 && Math.abs(pz - z) < 1e-9),
        );
        expect(found).toBe(true);
      }
    });

    it(`stands a pergola turned ${rotation}° inside its own rectangle`, () => {
      const pergola = rect('g', 'structure', 10, 10, 4, 3, {
        symbol: 'pergola',
        material: 'softwood',
        shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 4, depth: 3, rotation },
      });
      const { scene: built } = scene([pergola]);
      const node = built.nodes.find((candidate) => candidate.id === 'g')!;
      expect(node.kind).toBe('solid');
      const origin = built.frame.origin.plan;
      const ring = rectToPolygon({ centre: { x: 10, y: 10 }, width: 4, depth: 3, rotation }).map(
        (point) => planToGround(point, origin),
      );
      const corners = ring.map(([x, z]) => ({ x, y: z }));
      if (node.kind !== 'solid') return;
      let far = 0;
      for (const part of node.parts) {
        for (let i = 0; i < part.mesh.positions.length; i += 3) {
          const point = { x: part.mesh.positions[i]!, y: part.mesh.positions[i + 2]! };
          expect(pointInPolygon(point, corners) || nearRing(point, ring, 1e-6)).toBe(true);
          far = Math.max(far, Math.hypot(point.x - (10 - origin.x), point.y - (10 - origin.y)));
        }
      }
      // The posts stand in the corners: the frame reaches the rectangle's own half-diagonal.
      expect(far).toBeCloseTo(Math.hypot(2, 1.5), 6);
    });
  }
});

describe('frame', () => {
  it('points north the way the plan says', () => {
    expect(northOf(0)).toEqual([0, -1]);
    expect(northOf(90)).toEqual([1, 0]);
    expect(northOf(180)).toEqual([0, 1]);
  });

  it('falls back to the middle of the plot with no house', () => {
    const { scene: built } = scene([]);
    expect(built.frame.origin).toEqual({ kind: 'boundary-centroid', plan: { x: 10, y: 10 } });
  });
});

describe('rankOf', () => {
  it('is a stable unit interval', () => {
    expect(rankOf('bed-1:mass:3,4')).toBe(rankOf('bed-1:mass:3,4'));
    for (const id of ['', 'a', 'bed-1:mass:3,4', 'x'.repeat(200)]) {
      expect(rankOf(id)).toBeGreaterThanOrEqual(0);
      expect(rankOf(id)).toBeLessThan(1);
    }
  });
});
