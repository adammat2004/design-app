import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { ElementCategory, LocalPoint, MaterialId, RoofMaterial } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '../concept-colours';
import { MATERIAL_FILLS } from '../material-colours';
import { ASSET_FAMILIES } from '../materials/assets/asset-spec';
import { ASSET_BASE_URL } from '../materials/assets/browser-loader';
import { catalogueVariants } from '../materials/assets/catalogue';
import { materialAssets } from '../materials/assets/material-assets';
import { roofFor } from '../render/roof';

/**
 * Geometry for the structure's surroundings, built from what `structureNeighbourhood` decided.
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
 */
export function surfaceGeometry(
  ring: LocalPoint[],
  y: number,
  uv: SurfaceUv,
  thickness = 0,
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
  return geometryOf(vertices, uvs);
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
  const positive = signedArea(points) > 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    // The edge's outward normal in XZ follows from the ring's winding.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const out: Vec3 = positive ? [-dz, 0, dx] : [dz, 0, -dx];
    pushFacing(vertices, [a.x, base, a.z], [b.x, base, b.z], [b.x, top, b.z], out);
    pushFacing(vertices, [a.x, base, a.z], [b.x, top, b.z], [a.x, top, a.z], out);
  }
  return geometryOf(vertices);
}

/** How steep a house's roof is drawn: its rise as a share of the shorter span. */
export const ROOF_PITCH_SHARE = 0.35;

/**
 * The house's roof, lifted from the plan's own `roofFor` so the 3D roof is the same hip or gable
 * the plan draws. A plane vertex that is on the eaves ring stays at eaves height; every other one is
 * the ridge and goes up by the rise. A gable's end walls come back separately, to be drawn as wall.
 */
export function roofGeometry(
  ring: LocalPoint[],
  eaves: number,
  material?: RoofMaterial,
): { roof: BufferGeometry; gables: BufferGeometry | null } | null {
  const points = clean(ring);
  if (points.length < 3) return null;
  const plan = points.map((point) => ({ x: point.x, y: point.z }));
  const roof = roofFor(plan, { x: -1, y: -1 }, material ? { material } : {});
  if (!roof) return null;

  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const rise = roof.form === 'flat' ? 0 : span * ROOF_PITCH_SHARE;
  const onEaves = (p: { x: number; y: number }) =>
    roof.eaves.some((corner) => Math.hypot(corner.x - p.x, corner.y - p.y) < 1e-6);
  const lift = (p: { x: number; y: number }): Vec3 => [p.x, onEaves(p) ? eaves : eaves + rise, p.y];

  const vertices: Vec3[] = [];
  for (const plane of roof.planes) {
    const lifted = plane.outline.map(lift);
    if (lifted.length <= 4) {
      // A slope is a triangle or a quad: a fan is exact.
      for (let i = 1; i + 1 < lifted.length; i += 1) {
        pushFacing(vertices, lifted[0]!, lifted[i]!, lifted[i + 1]!, [0, 1, 0]);
      }
      continue;
    }
    // The ridge cap on an irregular house is the inset ring, which can be concave.
    const contour = plane.outline.map((point) => new Vector2(point.x, point.y));
    for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
      pushFacing(vertices, lifted[i!]!, lifted[j!]!, lifted[k!]!, [0, 1, 0]);
    }
  }

  let gables: BufferGeometry | null = null;
  if (roof.form === 'gable' && roof.eaves.length === 4 && roof.ridge[0]) {
    const [r0, r1] = roof.ridge[0];
    const corners = roof.eaves;
    const centre: Vec3 = [(r0.x + r1.x) / 2, eaves, (r0.y + r1.y) / 2];
    const end = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      ridge: { x: number; y: number },
    ) => {
      const out: Vec3 = [ridge.x - centre[0], 0, ridge.y - centre[2]];
      const triangle: Vec3[] = [];
      pushFacing(
        triangle,
        [a.x, eaves, a.y],
        [b.x, eaves, b.y],
        [ridge.x, eaves + rise, ridge.y],
        out,
      );
      return triangle;
    };
    gables = geometryOf([
      ...end(corners[3]!, corners[0]!, r0),
      ...end(corners[1]!, corners[2]!, r1),
    ]);
  }

  return { roof: geometryOf(vertices), gables };
}

/**
 * The picture a ground material is drawn with where the plan's painter has none, and how many metres
 * one copy covers each way. The plan's own library: a unit's face where it has one, else its
 * texture. `null` when there is no file — a supported state everywhere in this app, drawn as the
 * flat colour instead.
 */
export function surfaceTexture(
  materialId: string | null,
): { url: string; tile: { u: number; v: number } } | null {
  const assets = materialAssets(materialId ?? undefined);
  // The face first: it is the material itself. A texture beside a face is what lies *between* the
  // units — the grass round stepping stones — and tiled on its own would draw a lawn.
  const asset = assets?.face ?? assets?.texture;
  if (!asset) return null;
  const entry = catalogueVariants(asset)[0];
  if (!entry) return null;
  // Both sides of the picture, not its width twice: a decking board is 3.6 × 0.145 m, and drawn
  // square it would be a 3.6 m plank of wood grain.
  const { w, h } = ASSET_FAMILIES[asset].metres;
  return { url: `${ASSET_BASE_URL}${entry.file}`, tile: { u: w, v: h } };
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

const SEAT = 0.44;
const TABLE = 0.74;
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
    const inset = 0.6;
    // The table: a top on four legs, with the chairs round it.
    parts.push(box.part(inset, w - inset, inset, d - inset, TABLE - TOP, TOP));
    for (const [a, b] of [
      [inset + 0.08, inset + 0.08],
      [w - inset - 0.14, inset + 0.08],
      [w - inset - 0.14, d - inset - 0.14],
      [inset + 0.08, d - inset - 0.14],
    ] as const) {
      parts.push(box.part(a, a + 0.06, b, b + 0.06, 0, TABLE - TOP));
    }
    const chairs: { a: number; b: number; facing: 'a-' | 'a+' | 'b-' | 'b+' }[] =
      symbol === 'dining-set-4'
        ? [
            { a: w / 2, b: 0.3, facing: 'b+' },
            { a: w / 2, b: d - 0.3, facing: 'b-' },
            { a: 0.3, b: d / 2, facing: 'a+' },
            { a: w - 0.3, b: d / 2, facing: 'a-' },
          ]
        : [
            { a: w / 3, b: 0.3, facing: 'b+' },
            { a: (2 * w) / 3, b: 0.3, facing: 'b+' },
            { a: w / 3, b: d - 0.3, facing: 'b-' },
            { a: (2 * w) / 3, b: d - 0.3, facing: 'b-' },
            { a: 0.3, b: d / 2, facing: 'a+' },
            { a: w - 0.3, b: d / 2, facing: 'a-' },
          ];
    for (const chair of chairs) parts.push(...box.chair(chair.a, chair.b, chair.facing));
    return parts;
  }

  if (symbol === 'sofa-set') {
    const deep = Math.min(0.85, d * 0.4);
    return [
      // The sofa along the back, on its frame, with a back and two arms.
      box.part(0.1, w - 0.1, d - deep, d - 0.05, 0, SEAT - 0.1),
      { ...box.part(0.25, w - 0.25, d - deep, d - 0.2, SEAT - 0.1, 0.12), cushion: true },
      { ...box.part(0.1, w - 0.1, d - 0.2, d - 0.05, SEAT - 0.1, 0.42), cushion: true },
      box.part(0.1, 0.25, d - deep, d - 0.05, SEAT - 0.1, 0.24),
      box.part(w - 0.25, w - 0.1, d - deep, d - 0.05, SEAT - 0.1, 0.24),
      // A low table in front of it.
      box.part(w / 2 - 0.5, w / 2 + 0.5, 0.45, 1.05, 0.34, 0.06),
      box.part(w / 2 - 0.45, w / 2 + 0.45, 0.5, 1.0, 0, 0.34),
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
