import type { Vec2, Vec3 } from './coordinates.js';
import { rotateAboutY } from './coordinates.js';
import type { Mesh } from './scene.js';

/**
 * Small, dependency-free builders for the `Mesh` shape.
 *
 * For hand-written fixtures and early experiments, not the production builder: `flatPolygonMesh`
 * ear-clips a simple polygon with no holes, which is enough for a sample garden and not enough for
 * a patio with a tree cut out of it (the real builder should use `earcut`, which handles holes).
 * They live here rather than in `apps/mobile` so a fixture written on either side of the boundary
 * produces identical triangles.
 */

/**
 * A flat polygon at height `y`, with upward-facing triangles and world-space UVs.
 *
 * Winding is checked, not assumed: a ring that runs clockwise on the plan's screen has a positive
 * `X·Z` shoelace, and its triangles would face down and be culled. Reversing it first is the whole
 * of why this function exists rather than a triangle fan.
 */
export function flatPolygonMesh(ring: Vec2[], y: number, tileSizeM = 1): Mesh {
  const points = shoelace(ring) > 0 ? [...ring].reverse() : [...ring];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const [x, z] of points) {
    positions.push(x, y, z);
    normals.push(0, 1, 0);
    uvs.push(x / tileSizeM, z / tileSizeM);
  }
  return { positions, normals, uvs, indices: earClip(points) };
}

/**
 * An axis-aligned box of `size` `[width, height, depth]` standing on `base` (its bottom centre),
 * turned `yaw` radians about +Y. Outward normals, counter-clockwise faces, UVs in metres over
 * `tileSizeM` so a textured wall tiles at its true size.
 */
export function boxMesh(base: Vec3, size: Vec3, yaw = 0, tileSizeM = 1): Mesh {
  const [w, h, d] = size;
  const half: Vec3 = [w / 2, h / 2, d / 2];
  const centre: Vec3 = [0, h / 2, 0];
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };

  // Each face is its normal and two in-plane axes with `u × v = normal`, which is what makes the
  // corner order below counter-clockwise seen from outside.
  const faces: [normal: Vec3, u: Vec3, v: Vec3][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ];

  for (const [normal, u, v] of faces) {
    const start = mesh.positions.length / 3;
    const uSize = 2 * extent(u, half);
    const vSize = 2 * extent(v, half);
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const local: Vec3 = [
        centre[0] + normal[0] * half[0] + su * u[0] * half[0] + sv * v[0] * half[0],
        centre[1] + normal[1] * half[1] + su * u[1] * half[1] + sv * v[1] * half[1],
        centre[2] + normal[2] * half[2] + su * u[2] * half[2] + sv * v[2] * half[2],
      ];
      const [x, z] = rotateAboutY([local[0], local[2]], yaw);
      mesh.positions.push(base[0] + x, base[1] + local[1], base[2] + z);
      const [nx, nz] = rotateAboutY([normal[0], normal[2]], yaw);
      mesh.normals.push(nx, normal[1], nz);
      mesh.uvs.push(((su + 1) / 2) * (uSize / tileSizeM), ((sv + 1) / 2) * (vSize / tileSizeM));
    }
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return mesh;
}

/** Several meshes as one — one draw call instead of many, where they share a material. */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  const merged: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (const mesh of meshes) {
    const offset = merged.positions.length / 3;
    merged.positions.push(...mesh.positions);
    merged.normals.push(...mesh.normals);
    merged.uvs.push(...mesh.uvs);
    merged.indices.push(...mesh.indices.map((index) => index + offset));
  }
  return merged;
}

/** Twice the signed area of a ring in `X·Z`. Positive means its triangles would face down. */
export function shoelace(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    sum += x1 * z2 - x2 * z1;
  }
  return sum;
}

/** How far `half` reaches along the unit axis `axis`. */
function extent(axis: Vec3, half: Vec3): number {
  return Math.abs(axis[0] * half[0] + axis[1] * half[1] + axis[2] * half[2]);
}

/**
 * Ear clipping for a simple polygon already wound so its triangles face up (negative shoelace).
 * O(n³) in the worst case, which is irrelevant at fixture sizes.
 */
function earClip(points: Vec2[]): number[] {
  const remaining = points.map((_, index) => index);
  const indices: number[] = [];
  let guard = 0;
  while (remaining.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length]!;
      const b = remaining[i]!;
      const c = remaining[(i + 1) % remaining.length]!;
      if (!isConvex(points[a]!, points[b]!, points[c]!)) continue;
      const blocked = remaining.some(
        (p) =>
          p !== a &&
          p !== b &&
          p !== c &&
          inTriangle(points[p]!, points[a]!, points[b]!, points[c]!),
      );
      if (blocked) continue;
      indices.push(a, b, c);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('flatPolygonMesh: the polygon is not simple.');
  }
  indices.push(remaining[0]!, remaining[1]!, remaining[2]!);
  return indices;
}

/** A corner is convex when it turns the same way as the (upward-facing) ring. */
function isConvex(a: Vec2, b: Vec2, c: Vec2): boolean {
  return cross(a, b, c) < 0;
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return d1 <= 0 && d2 <= 0 && d3 <= 0;
}
