import { describe, expect, it } from 'vitest';
import type { Vec2 } from './coordinates.js';
import { boxMesh, flatPolygonMesh, mergeMeshes, shoelace } from './mesh-helpers.js';
import type { Mesh } from './scene.js';

function vertex(mesh: Mesh, index: number): [number, number, number] {
  return [
    mesh.positions[index * 3]!,
    mesh.positions[index * 3 + 1]!,
    mesh.positions[index * 3 + 2]!,
  ];
}

function triangles(mesh: Mesh): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    out.push([
      vertex(mesh, mesh.indices[i]!),
      vertex(mesh, mesh.indices[i + 1]!),
      vertex(mesh, mesh.indices[i + 2]!),
    ]);
  }
  return out;
}

/** The face normal a counter-clockwise triangle implies: (b − a) × (c − a). */
function faceNormal([a, b, c]: [number, number, number][]): [number, number, number] {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
}

const L_SHAPE: Vec2[] = [
  [0, 0],
  [6, 0],
  [6, 2],
  [2, 2],
  [2, 5],
  [0, 5],
];

describe('flatPolygonMesh', () => {
  it.each([
    ['as drawn', L_SHAPE],
    ['reversed', [...L_SHAPE].reverse()],
  ])('faces up whichever way the ring runs (%s)', (_, ring) => {
    const mesh = flatPolygonMesh(ring, 0.2);
    for (const triangle of triangles(mesh)) {
      expect(faceNormal(triangle)[1]).toBeGreaterThan(0);
    }
  });

  it('covers exactly the polygon, concave corner included', () => {
    const mesh = flatPolygonMesh(L_SHAPE, 0);
    const area = triangles(mesh).reduce((sum, triangle) => sum + faceNormal(triangle)[1] / 2, 0);
    expect(area).toBeCloseTo(Math.abs(shoelace(L_SHAPE)) / 2, 9);
    expect(area).toBeCloseTo(6 * 2 + 2 * 3, 9);
    expect(mesh.indices).toHaveLength((L_SHAPE.length - 2) * 3);
  });

  it('puts UVs in world metres over the tile size', () => {
    const mesh = flatPolygonMesh(L_SHAPE, 0, 0.5);
    const index = mesh.positions.findIndex((_, i) => i % 3 === 0 && mesh.positions[i] === 6) / 3;
    expect(mesh.uvs[index * 2]).toBe(12);
  });
});

describe('boxMesh', () => {
  it('has outward faces whatever its yaw', () => {
    for (const yaw of [0, 0.4, Math.PI / 2, 2.2]) {
      const base: [number, number, number] = [3, 0.5, -2];
      const mesh = boxMesh(base, [2, 1, 1.5], yaw);
      const centre = [base[0], base[1] + 0.5, base[2]];
      for (const triangle of triangles(mesh)) {
        const normal = faceNormal(triangle);
        const mid = [0, 1, 2].map(
          (axis) => (triangle[0]![axis]! + triangle[1]![axis]! + triangle[2]![axis]!) / 3,
        );
        const outward = mid.map((value, axis) => value - centre[axis]!);
        expect(
          normal[0] * outward[0]! + normal[1] * outward[1]! + normal[2] * outward[2]!,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('stands on its base and is the size it was asked to be', () => {
    const mesh = boxMesh([0, 0, 0], [3, 2.4, 3]);
    const ys = triangles(mesh)
      .flat()
      .map((point) => point[1]);
    const xs = triangles(mesh)
      .flat()
      .map((point) => point[0]);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(2.4, 12);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3, 12);
  });
});

describe('mergeMeshes', () => {
  it('offsets the second mesh’s indices past the first', () => {
    const a = boxMesh([0, 0, 0], [1, 1, 1]);
    const b = boxMesh([5, 0, 0], [1, 1, 1]);
    const merged = mergeMeshes([a, b]);
    expect(merged.positions).toHaveLength(a.positions.length + b.positions.length);
    expect(Math.max(...merged.indices)).toBe(merged.positions.length / 3 - 1);
  });
});
