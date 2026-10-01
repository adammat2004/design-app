import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { ElementCategory, LocalPoint, MaterialId } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '../concept-colours';
import { MATERIAL_FILLS } from '../material-colours';
import { diningLayout, loungeLayout, SEAT, TABLE } from './furniture-layout';

/**
 * Geometry the 3D views build in the web: a structure's floor, extruded solids and furniture parts.
 *
 * Pure three.js data — `BufferGeometry` needs no WebGL — so it is tested in jsdom. Everything is in
 * the structure's local frame (X across, Y up, Z towards the front) and is built **directly in XZ**
 * rather than through `ShapeGeometry` and a quarter turn about X, which maps a shape's +y to −Z and
 * would draw the whole neighbourhood mirrored front to back. Every triangle is wound to face the way
 * it should (up for ground and roofs, out for walls), so single-sided materials and shadows work.
 */

type Vec3 = [number, number, number];

/** A ring with repeated and closing points removed, which the triangulator does not want. */
function clean(ring: LocalPoint[]): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (const point of ring) {
    const last = out.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) > 1e-6) out.push(point);
  }
  const first = out[0];
  const last = out.at(-1);
  if (first && last && out.length > 1 && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6)
    out.pop();
  return out;
}

/**
 * Twice the signed area in XZ. Its sign is only ever used to tell which side of an edge is outside,
 * and the test that stands walls up pins that — the handedness here is easy to get backwards.
 */
function signedArea(ring: LocalPoint[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.z * b.x - a.x * b.z;
  }
  return twice;
}

/** Adds a triangle wound so its normal points along `towards`. */
function pushFacing(out: Vec3[], a: Vec3, b: Vec3, c: Vec3, towards: Vec3): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  const dot = normal[0]! * towards[0] + normal[1]! * towards[1] + normal[2]! * towards[2];
  if (dot >= 0) out.push(a, b, c);
  else out.push(a, c, b);
}

function geometryOf(vertices: Vec3[], uvs?: [number, number][]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices.flat(), 3));
  if (uvs) geometry.setAttribute('uv', new Float32BufferAttribute(uvs.flat(), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** The triangles of a flat ring at height `y`, facing up. */
function capTriangles(ring: LocalPoint[], y: number): Vec3[] {
  const contour = ring.map((point) => new Vector2(point.x, point.z));
  const out: Vec3[] = [];
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
    const a = ring[i!]!;
    const b = ring[j!]!;
    const c = ring[k!]!;
    pushFacing(out, [a.x, y, a.z], [b.x, y, b.z], [c.x, y, c.z], [0, 1, 0]);
  }
  return out;
}

/** How a surface's picture is laid on it: a texture coordinate for every point of the ring. */
export type SurfaceUv = (point: LocalPoint) => [number, number];

/** A picture repeated every `u` by `v` metres, laid in local metres. */
export function tiledUv(u: number, v: number): SurfaceUv {
  const across = u > 0 ? u : 1;
  const along = v > 0 ? v : 1;
  return (point) => [point.x / across, -point.z / along];
}

/**
 * A ground surface: the ring laid flat at `y`, its picture placed by `uv` — the plan's own painted
 * raster for the surface, which keeps two patios that meet in one course, or a tile repeated in
 * metres. With `thickness`, it is a slab whose top is at `y`, so paving has an edge where it meets
 * the lawn rather than being printed on it.
 *
 * `detailUv` writes a second UV set, `uv1`, for relief laid in its own coordinates under the
 * colour — a floor's colour is the plan's raster, its relief a material set tiled in metres.
 */
export function surfaceGeometry(
  ring: LocalPoint[],
  y: number,
  uv: SurfaceUv,
  thickness = 0,
  detailUv?: SurfaceUv,
): BufferGeometry | null {
  const points = clean(ring);
  if (points.length < 3 || Math.abs(signedArea(points)) < 1e-6) return null;
  const vertices = capTriangles(points, y);
  if (vertices.length === 0) return null;
  const uvs = vertices.map(([x, , z]) => uv({ x, z }));
  if (thickness > 0) {
    const positive = signedArea(points) > 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const out: Vec3 = positive ? [-dz, 0, dx] : [dz, 0, -dx];
      const side: Vec3[] = [];
      pushFacing(side, [a.x, y - thickness, a.z], [b.x, y - thickness, b.z], [b.x, y, b.z], out);
      pushFacing(side, [a.x, y - thickness, a.z], [b.x, y, b.z], [a.x, y, a.z], out);
      for (const vertex of side) {
        vertices.push(vertex);
        // The edge takes the colour at the top of the slab it belongs to.
        uvs.push(uv({ x: vertex[0], z: vertex[2] }));
      }
    }
  }
  const geometry = geometryOf(vertices, uvs);
  if (detailUv) {
    geometry.setAttribute(
      'uv1',
      new Float32BufferAttribute(
        vertices.flatMap(([x, , z]) => detailUv({ x, z })),
        2,
      ),
    );
  }
  return geometry;
}

/** A footprint stood up from `base` to `base + height`: walls facing out and a cap. */
export function extrudedGeometry(
  ring: LocalPoint[],
  base: number,
  height: number,
): BufferGeometry | null {
  const points = clean(ring);
  if (points.length < 3 || height <= 0 || Math.abs(signedArea(points)) < 1e-6) return null;
  const top = base + height;
  const vertices: Vec3[] = capTriangles(points, top);
  /*
   * Texture coordinates in metres, so a material photograph lays at its real size: the top in plan
   * metres, each wall with U running along the ring (continued from wall to wall, so a grain or a
   * weave carries round a corner) and V up the wall.
   */
  const uvs: [number, number][] = vertices.map(([x, , z]) => [x, -z]);
  const positive = signedArea(points) > 0;
  let along = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    // The edge's outward normal in XZ follows from the ring's winding.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const out: Vec3 = positive ? [-dz, 0, dx] : [dz, 0, -dx];
    const length = Math.hypot(dx, dz);
    const wall: Vec3[] = [];
    pushFacing(wall, [a.x, base, a.z], [b.x, base, b.z], [b.x, top, b.z], out);
    pushFacing(wall, [a.x, base, a.z], [b.x, top, b.z], [a.x, top, a.z], out);
    for (const vertex of wall) {
      const fromA = Math.hypot(vertex[0] - a.x, vertex[2] - a.z);
      uvs.push([along + Math.min(fromA, length), vertex[1]]);
    }
    vertices.push(...wall);
    along += length;
  }
  return geometryOf(vertices, uvs);
}


/** The flat colour a surface falls back to: the plan's own fill for the material, else its category. */
export function surfaceColour(materialId: string | null, category: ElementCategory): string {
  return (
    (materialId && MATERIAL_FILLS[materialId as MaterialId]) || CATEGORY_COLOURS[category].fill
  );
}

/** One solid piece of a drawn object: a footprint stood up from `base` by `height`. */
export interface SolidPart {
  ring: LocalPoint[];
  base: number;
  height: number;
  /** A seat pad or a cushion, drawn in fabric rather than in the piece's own finish. */
  cushion?: boolean;
}

const TOP = 0.04;

/**
 * A piece of furniture as a handful of plain solids, so it reads as what it is: a dining set is a
 * table on legs with its chairs pulled up, a lounge set a sofa with a back and arms round a coffee
 * table, a lounger a pad with a raised back, a parasol a pole under a canopy. Anything else — a
 * planter, a barbecue — is the block its footprint is.
 *
 * Built in the piece's own frame (along its width and its depth), so it turns with the piece. The
 * far side of its depth is its back. **Every part lies inside the footprint**, the rule
 * `structureParts` keeps too, so the 3D piece takes exactly the ground the plan says. Heights are the
 * furniture's own: a chair back stands above the table the symbol's height describes.
 */
export function furnitureParts(
  symbol: string | undefined,
  ring: LocalPoint[],
  base: number,
  height: number,
): SolidPart[] {
  const box = pieceBox(ring, base);
  if (symbol === 'parasol') {
    return [
      { ring: scaleRing(ring, 0.04), base, height: height - TOP },
      { ring, base: base + height - TOP, height: TOP },
    ];
  }
  if (!box) return [{ ring, base, height }];
  const { w, d } = box;

  if (symbol === 'dining-set-4' || symbol === 'dining-set-6') {
    const parts: SolidPart[] = [];
    // The table: a top on four legs, with the chairs round it (`diningLayout`, shared with the models).
    const { table, chairs } = diningLayout(symbol, w, d);
    parts.push(box.part(table.a0, table.a1, table.b0, table.b1, TABLE - TOP, TOP));
    for (const [a, b] of [
      [table.a0 + 0.08, table.b0 + 0.08],
      [table.a1 - 0.14, table.b0 + 0.08],
      [table.a1 - 0.14, table.b1 - 0.14],
      [table.a0 + 0.08, table.b1 - 0.14],
    ] as const) {
      parts.push(box.part(a, a + 0.06, b, b + 0.06, 0, TABLE - TOP));
    }
    for (const chair of chairs) parts.push(...box.chair(chair.a, chair.b, chair.facing));
    return parts;
  }

  if (symbol === 'sofa-set') {
    const { sofa, table } = loungeLayout(w, d);
    return [
      // The sofa along the back, on its frame, with a back and two arms.
      box.part(sofa.a0, sofa.a1, sofa.b0, sofa.b1, 0, SEAT - 0.1),
      {
        ...box.part(sofa.a0 + 0.15, sofa.a1 - 0.15, sofa.b0, d - 0.2, SEAT - 0.1, 0.12),
        cushion: true,
      },
      { ...box.part(sofa.a0, sofa.a1, d - 0.2, sofa.b1, SEAT - 0.1, 0.42), cushion: true },
      box.part(sofa.a0, sofa.a0 + 0.15, sofa.b0, sofa.b1, SEAT - 0.1, 0.24),
      box.part(sofa.a1 - 0.15, sofa.a1, sofa.b0, sofa.b1, SEAT - 0.1, 0.24),
      // A low table in front of it.
      box.part(table.a0, table.a1, table.b0, table.b1, 0.34, 0.06),
      box.part(table.a0 + 0.05, table.a1 - 0.05, table.b0 + 0.05, table.b1 - 0.05, 0, 0.34),
    ];
  }

  if (symbol === 'lounger') {
    return [
      box.part(0.05, w - 0.05, 0.1, d - 0.1, 0, 0.22),
      { ...box.part(0.08, w - 0.08, 0.12, d - 0.7, 0.22, 0.08), cushion: true },
      {
        ...box.part(0.08, w - 0.08, d - 0.6, d - 0.12, 0.22, Math.max(0.1, height - 0.22)),
        cushion: true,
      },
    ];
  }

  if (symbol === 'bench') {
    return [
      box.part(0.05, 0.15, 0.1, d - 0.1, 0, SEAT - 0.05),
      box.part(w - 0.15, w - 0.05, 0.1, d - 0.1, 0, SEAT - 0.05),
      box.part(0, w, 0, d - 0.1, SEAT - 0.05, 0.05),
      box.part(0, w, d - 0.08, d, SEAT - 0.05, Math.max(0.1, height - SEAT + 0.05)),
    ];
  }

  if (symbol === 'bbq') {
    return [
      box.part(0.1, w - 0.1, 0.05, d - 0.05, 0, height - 0.15),
      box.part(0.2, w - 0.2, 0.1, d - 0.1, height - 0.15, 0.15),
    ];
  }

  return [{ ring, base, height }];
}

/**
 * A rectangular piece's own frame, from its four corners: parts are placed by how far along its
 * width (`a`) and its depth (`b`) they are, which turns them with the piece whatever its rotation.
 */
function pieceBox(ring: LocalPoint[], base: number) {
  if (ring.length !== 4) return null;
  const [p0, p1, , p3] = ring as [LocalPoint, LocalPoint, LocalPoint, LocalPoint];
  const w = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const d = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  if (w < 1e-6 || d < 1e-6) return null;
  const u = { x: (p1.x - p0.x) / w, z: (p1.z - p0.z) / w };
  const v = { x: (p3.x - p0.x) / d, z: (p3.z - p0.z) / d };
  const at = (a: number, b: number): LocalPoint => ({
    x: p0.x + u.x * a + v.x * b,
    z: p0.z + u.z * a + v.z * b,
  });
  const clampA = (a: number) => Math.min(w, Math.max(0, a));
  const clampB = (b: number) => Math.min(d, Math.max(0, b));
  const part = (
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    bottom: number,
    tall: number,
  ): SolidPart => ({
    ring: [
      at(clampA(a0), clampB(b0)),
      at(clampA(a1), clampB(b0)),
      at(clampA(a1), clampB(b1)),
      at(clampA(a0), clampB(b1)),
    ],
    base: base + bottom,
    height: tall,
  });
  /** A chair centred at (a, b), facing the table along `facing`: a seat, a pad and a back. */
  const chair = (a: number, b: number, facing: 'a-' | 'a+' | 'b-' | 'b+'): SolidPart[] => {
    const half = 0.22;
    const seat = part(a - half, a + half, b - half, b + half, 0, SEAT - 0.04);
    const pad = {
      ...part(a - half, a + half, b - half, b + half, SEAT - 0.04, 0.04),
      cushion: true,
    };
    const back =
      facing === 'b+'
        ? part(a - half, a + half, b - half, b - half + 0.05, SEAT, 0.42)
        : facing === 'b-'
          ? part(a - half, a + half, b + half - 0.05, b + half, SEAT, 0.42)
          : facing === 'a+'
            ? part(a - half, a - half + 0.05, b - half, b + half, SEAT, 0.42)
            : part(a + half - 0.05, a + half, b - half, b + half, SEAT, 0.42);
    return [seat, pad, back];
  };
  return { w, d, part, chair };
}

/** A ring scaled about its own centre. */
function scaleRing(ring: LocalPoint[], factor: number): LocalPoint[] {
  const centre = ring.reduce((sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }), {
    x: 0,
    z: 0,
  });
  const cx = centre.x / ring.length;
  const cz = centre.z / ring.length;
  return ring.map((point) => ({
    x: cx + (point.x - cx) * factor,
    z: cz + (point.z - cz) * factor,
  }));
}
