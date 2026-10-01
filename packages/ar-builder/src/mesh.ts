import earcut from 'earcut';
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { Mesh, Vec2, Vec3 } from '@garden-studio/ar-contract';

/**
 * The geometry a scene is made of: ground cut so nothing overlaps, flat surfaces triangulated so
 * they face up, and the few solid shapes the minimum builder needs.
 *
 * ## The cut, and why it is a library
 *
 * The plan stacks its surfaces on purpose — a base fill is a whole zone and the patio is drawn over
 * it — and a depth buffer draws two surfaces at one height as flicker. So every surface is cut by
 * everything stacked above it. `polygon-clipping` does the difference: it was measured against the
 * eleven fixture plans (no failure, area conserved to 1e-14 m², 14 ms for all of them) and against
 * the degenerate rings this plan really produces — a path strip that folds into a bow tie, a
 * zero-area sliver, duplicate points — where another candidate threw. PostGIS would give the same
 * answer on the server, but the preview runs in the browser on edits that are not saved yet.
 *
 * A cut can still fail on something nobody has seen yet, so `cutSurface` falls back to the uncut
 * ring and says so: a surface that flickers is a fault; a garden that does not load is worse.
 */

/**
 * The grids a cut is snapped to before it is attempted: a micrometre, then a tenth of a millimetre.
 *
 * `polygon-clipping` is exact on clean input and fragile on near-coincident segments — it throws
 * "Unable to find segment … in SweepLine tree" when two edges differ by float noise. Moving a plan
 * to the scene's origin *makes* that noise (`4.4999999999999964` beside `4.500000000000002`), and
 * the first build of the fixtures failed on exactly that where the spike, cutting in raw plan
 * coordinates, had not. Snapping removes it, and a micrometre is far below anything a garden is
 * built to.
 */
const SNAP_GRIDS = [1e-6, 1e-4];

/** `ring` minus every ring in `above`, as polygons with holes. `null` when every attempt threw. */
export function cutSurface(ring: Vec2[], above: Vec2[][]): MultiPolygon | null {
  if (above.length === 0) return [[ring]];
  for (const grid of SNAP_GRIDS) {
    const snap = (points: Vec2[]): Vec2[] =>
      points.map(([x, z]) => [snapTo(x, grid), snapTo(z, grid)]);
    try {
      return polygonClipping.difference(
        [snap(ring)],
        ...above.map((clip): Polygon => [snap(clip)]),
      );
    } catch {
      // Try the next, coarser grid.
    }
  }
  return null;
}

function snapTo(value: number, grid: number): number {
  return Math.round(value / grid) * grid || 0;
}

/** A ring as the library returns it, closed, with its repeated last point dropped. */
function open(ring: Vec2[]): Vec2[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

/**
 * Flat polygons at height `y`, facing up, with world-space UVs.
 *
 * Winding is enforced **per triangle** rather than assumed from the ring: whichever way a ring
 * runs, and whatever orientation `earcut` hands back, every triangle is checked and flipped so its
 * normal is +Y. A downward triangle is culled by the engine and a lawn with holes in it is the
 * first thing anybody would notice.
 */
export function flatMesh(polygons: MultiPolygon, y: number, tileSizeM = 1): Mesh {
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (const polygon of polygons) {
    const rings = polygon.map(open).filter((ring) => ring.length >= 3);
    if (rings.length === 0) continue;
    const flat: number[] = [];
    const holes: number[] = [];
    rings.forEach((ring, index) => {
      if (index > 0) holes.push(flat.length / 2);
      for (const [x, z] of ring) flat.push(x, z);
    });
    const triangles = earcut(flat, holes, 2);
    const start = mesh.positions.length / 3;
    for (let i = 0; i < flat.length; i += 2) {
      mesh.positions.push(flat[i]!, y, flat[i + 1]!);
      mesh.normals.push(0, 1, 0);
      mesh.uvs.push(flat[i]! / tileSizeM, flat[i + 1]! / tileSizeM);
    }
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!;
      const b = triangles[t + 1]!;
      const c = triangles[t + 2]!;
      mesh.indices.push(
        start + a,
        ...(facesUp(flat, a, b, c) ? [start + b, start + c] : [start + c, start + b]),
      );
    }
  }
  return mesh;
}

/** Whether triangle `a b c` of a flat `[x, z, …]` array faces +Y as written. */
function facesUp(flat: number[], a: number, b: number, c: number): boolean {
  const ux = flat[b * 2]! - flat[a * 2]!;
  const uz = flat[b * 2 + 1]! - flat[a * 2 + 1]!;
  const vx = flat[c * 2]! - flat[a * 2]!;
  const vz = flat[c * 2 + 1]! - flat[a * 2 + 1]!;
  // The y component of u × v for vectors lying in the ground: positive means the normal points up.
  return uz * vx - ux * vz > 0;
}

/** Twice the signed area in X·Z. Positive means the ring's triangles would face down. */
function shoelace(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    sum += x1 * z2 - x2 * z1;
  }
  return sum;
}

/**
 * A ring stood up from `base` to `base + height`: outward-facing walls and an upward-facing top.
 * No bottom — nothing is ever seen from below the ground. UVs on the walls run in metres along the
 * wall and up it, so a textured wall tiles at its true size.
 */
export function prismMesh(ring: Vec2[], base: number, height: number, tileSizeM = 1): Mesh {
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  if (ring.length < 3 || height <= 0) return mesh;
  // Walk the ring so that its triangles would face up (shoelace < 0). Walked that way, the outward
  // normal of an edge running (dx, dz) is (−dz, dx): on a unit square the edge along z = 1 runs +X
  // and faces +Z. The test that probes behind every wall pins this.
  const points = shoelace(ring) > 0 ? [...ring].reverse() : ring;
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!;
    const [x2, z2] = points[(i + 1) % points.length]!;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length === 0) continue;
    const nx = -(z2 - z1) / length;
    const nz = (x2 - x1) / length;
    const start = mesh.positions.length / 3;
    const corners: [number, number, number, number][] = [
      [x1, base, z1, along],
      [x2, base, z2, along + length],
      [x2, base + height, z2, along + length],
      [x1, base + height, z1, along],
    ];
    for (const [x, y, z, u] of corners) {
      mesh.positions.push(x, y, z);
      mesh.normals.push(nx, 0, nz);
      mesh.uvs.push(u / tileSizeM, (y - base) / tileSizeM);
    }
    orientQuad(mesh, start, [nx, 0, nz]);
    along += length;
  }
  const top = flatMesh([[points]], base + height, tileSizeM);
  return mergeInto(mesh, top);
}

/**
 * A four-sided hipped roof over a `width × depth` footprint centred on `centre`, rising `rise` to
 * an apex, turned `yaw` about +Y. Four triangles, each facing outwards and up.
 */
export function pyramidMesh(
  centre: Vec3,
  width: number,
  depth: number,
  rise: number,
  yaw: number,
): Mesh {
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  const [cx, cy, cz] = centre;
  const turn = (x: number, z: number): Vec2 => {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return [cx + x * cos + z * sin, cz - x * sin + z * cos];
  };
  const hw = width / 2;
  const hd = depth / 2;
  const corners: Vec2[] = [turn(-hw, -hd), turn(hw, -hd), turn(hw, hd), turn(-hw, hd)];
  const apex: Vec3 = [cx, cy + rise, cz];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const p1: Vec3 = [a[0], cy, a[1]];
    const p2: Vec3 = [b[0], cy, b[1]];
    const normal = unit(cross(sub(p2, p1), sub(apex, p1)));
    // The face must point away from the centre: flip the winding if the cross product points in.
    const outward = (p1[0] + p2[0]) / 2 - cx;
    const outwardZ = (p1[2] + p2[2]) / 2 - cz;
    const flip = normal[0] * outward + normal[2] * outwardZ < 0;
    const n: Vec3 = flip ? [-normal[0], -normal[1], -normal[2]] : normal;
    const start = mesh.positions.length / 3;
    for (const p of [p1, p2, apex]) {
      mesh.positions.push(...p);
      mesh.normals.push(...n);
    }
    mesh.uvs.push(
      0,
      0,
      Math.hypot(b[0] - a[0], b[1] - a[1]),
      0,
      Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
      rise,
    );
    mesh.indices.push(...(flip ? [start, start + 2, start + 1] : [start, start + 1, start + 2]));
  }
  return mesh;
}

/** Appends `quad`'s two triangles at `start`, wound so they face `normal`. */
function orientQuad(mesh: Mesh, start: number, normal: Vec3): void {
  const p = (i: number): Vec3 => [
    mesh.positions[(start + i) * 3]!,
    mesh.positions[(start + i) * 3 + 1]!,
    mesh.positions[(start + i) * 3 + 2]!,
  ];
  const face = cross(sub(p(1), p(0)), sub(p(2), p(0)));
  const agrees = face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] >= 0;
  mesh.indices.push(
    ...(agrees
      ? [start, start + 1, start + 2, start, start + 2, start + 3]
      : [start, start + 2, start + 1, start, start + 3, start + 2]),
  );
}

export function mergeInto(target: Mesh, ...meshes: Mesh[]): Mesh {
  for (const mesh of meshes) {
    const offset = target.positions.length / 3;
    target.positions.push(...mesh.positions);
    target.normals.push(...mesh.normals);
    target.uvs.push(...mesh.uvs);
    for (const index of mesh.indices) target.indices.push(index + offset);
  }
  return target;
}

export function emptyMesh(): Mesh {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
