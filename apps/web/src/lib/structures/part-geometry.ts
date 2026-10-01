import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  structureFinish,
  type FrameModel,
  type StructurePart,
  type Vec3,
} from '@garden-studio/schema';

/**
 * One part of a structure as a mesh at its real size, with texture coordinates in metres, and the
 * small facts about how it was made that turn a box into a piece of timber or a length of aluminium.
 *
 * The first 3D view drew every part with one shared unit box scaled to the part's size. That is free
 * while materials are flat colour and wrong the moment they are not: a 0.075 × 0.15 × 3.6 m rafter
 * scaled from a unit box stretches a texture fifty times along its length. Here the geometry *is* the
 * part — built in its own frame round its centre, placed at `shape.centre` with no scale.
 *
 * ## What it is made of
 *
 * Every box part is a **profile extruded along its grain** — its longest side, as in sawn timber:
 *
 * - **Edges are eased.** A sawn or extruded member never has a knife edge, and the eased edge is what
 *   catches the light and says "solid" rather than "polygon". 4 mm on timber, 2 mm on aluminium or
 *   steel, none on a polycarbonate panel or the light strip. A chamfer only removes material.
 * - **A classic rafter has its tails cut** on the top edge: an angled cut from the underside's end up
 *   and back, the traditional pergola rafter end. The underside keeps its full length, because that
 *   is what bears on the beam.
 * - **A modern louvre blade is an aerofoil**, not a plank: a lens-shaped section, smooth-shaded.
 * - **A timber post stands in a galvanised shoe**, drawn inside the post's own box — the shoe takes
 *   the full section at the foot and the timber above it is inset a few millimetres — so the one piece
 *   of hardware worth drawing costs no containment. It is geometry group 1, for a second material.
 *
 * No bolts: the beams bear straight down on the posts here, so a bolt would pass through nothing.
 *
 * ## Texture coordinates
 *
 * U is metres along the grain, V metres round the profile, continued face to face so a grain wraps a
 * corner instead of restarting. End faces take the cross-section. A per-part offset, hashed from the
 * part's stable id, slides each one to a different stretch of the texture. A pyramid roof lays U along
 * each eave and V up the slope.
 *
 * Pure geometry, and never an answer to where a part is: `structureParts` decides that, and every
 * vertex here stays inside the box it names — a test sweeps every configuration to say so.
 */
export function partGeometry(
  part: StructurePart,
  { model = 'classic' }: { model?: FrameModel } = {},
): BufferGeometry {
  const offset = grainOffset(part.id);
  return part.shape.kind === 'box'
    ? boxPart(part, part.shape.size, model, offset)
    : pyramidGeometry(part.shape.base, part.shape.rise, offset);
}

type Uv = [number, number];
type Point2 = [number, number];

/** Where along the texture a part starts: up to 3 m along the grain and 1 m across it. */
export function grainOffset(id: string): Uv {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const a = (hash >>> 0) / 4294967296;
  const b = (Math.imul(hash, 2654435761) >>> 0) / 4294967296;
  return [a * 3, b];
}

/** The axis a part's grain runs along: its longest side. Ties go to X, then Y. */
export function grainAxis(size: Vec3): 0 | 1 | 2 {
  if (size[0] >= size[1] && size[0] >= size[2]) return 0;
  return size[1] >= size[2] ? 1 : 2;
}

/* ---------------------------------------------------------------- how a part was made */

/** Eased edges, by what the part is made of. */
export const EASE_TIMBER = 0.004;
export const EASE_METAL = 0.002;
/** How far back the top of a classic rafter's tail is cut: an angle of about 60° on a 150 mm rafter. */
export const RAFTER_TAIL = 0.09;
/** A post shoe's height, and how far the timber above it is inset so the shoe reads as a sleeve. */
export const SHOE_HEIGHT = 0.14;
export const SHOE_INSET = 0.004;
/** Segments round a louvre blade's aerofoil. */
const BLADE_SEGMENTS = 16;

type Stock = 'timber' | 'metal' | 'sheet';

/** What a finish is, for the purposes of how its edges are made. */
export function stockOf(finishId: StructurePart['finish']): Stock {
  const finish = structureFinish(finishId);
  if (finish.opacity !== undefined || finish.emissive !== undefined) return 'sheet';
  return finish.metalness >= 0.5 ? 'metal' : 'timber';
}

function boxPart(part: StructurePart, size: Vec3, model: FrameModel, offset: Uv): BufferGeometry {
  const builder = new Builder();
  const g = grainAxis(size);
  const [p, q] = ([0, 1, 2] as const).filter((axis) => axis !== g) as [0 | 1 | 2, 0 | 1 | 2];
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const stock = stockOf(part.finish);
  const ease = stock === 'timber' ? EASE_TIMBER : stock === 'metal' ? EASE_METAL : 0;
  const axes = { g, p, q };

  // A modern roof's blades: an aerofoil, smooth.
  if (part.group === 'rafter' && model === 'modern') {
    prism(builder, axes, {
      section: ellipse(half[p], half[q], BLADE_SEGMENTS),
      smooth: true,
      from: -half[g],
      to: half[g],
      offset,
    });
    return builder.geometry();
  }

  const section = easedRect(half[p], half[q], ease);

  // A timber post in its shoe: the shoe at the foot, full section; the timber above, inset.
  if (part.group === 'post' && stock === 'timber' && g === 1 && size[1] > SHOE_HEIGHT * 3) {
    const shoeTop = -half[1] + SHOE_HEIGHT;
    prism(builder, axes, {
      section: easedRect(half[p], half[q], EASE_METAL),
      from: -half[1],
      to: shoeTop,
      offset,
      group: 1,
    });
    prism(builder, axes, {
      section: easedRect(half[p] - SHOE_INSET, half[q] - SHOE_INSET, ease),
      from: shoeTop,
      to: half[1],
      offset,
      // Its foot sits in the shoe and is never seen.
      caps: 'top',
    });
    return builder.geometry();
  }

  // A classic rafter: its tails cut on the top edge, both ends.
  const vertical = p === 1 ? 'p' : q === 1 ? 'q' : null;
  const tail =
    part.group === 'rafter' && model === 'classic' && stock === 'timber' && vertical && g !== 1
      ? Math.min(RAFTER_TAIL, half[g] * 0.5)
      : 0;
  prism(builder, axes, {
    section,
    from: -half[g],
    to: half[g],
    offset,
    endCut:
      tail > 0
        ? (a, b) => {
            // 0 at the underside, 1 at the top: the end moves back linearly as the cut rises.
            const height = vertical === 'p' ? a : b;
            const extent = vertical === 'p' ? half[p] : half[q];
            return tail * ((height + extent) / (2 * extent));
          }
        : undefined,
  });
  return builder.geometry();
}

/** A rectangle's section with its corners eased by `ease`, anticlockwise from the bottom right. */
export function easedRect(a: number, b: number, ease: number): Point2[] {
  const c = Math.min(ease, a * 0.25, b * 0.25);
  if (c <= 0) {
    return [
      [a, -b],
      [a, b],
      [-a, b],
      [-a, -b],
    ];
  }
  return [
    [a - c, -b],
    [a, -b + c],
    [a, b - c],
    [a - c, b],
    [-a + c, b],
    [-a, b - c],
    [-a, -b + c],
    [-a + c, -b],
  ];
}

function ellipse(a: number, b: number, segments: number): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    out.push([a * Math.cos(angle), b * Math.sin(angle)]);
  }
  return out;
}

/* ---------------------------------------------------------------- the extrusion */

class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  private readonly groups: { start: number; count: number; group: number }[] = [];

  /** A triangle, wound to face `normal`, its vertices carrying `normals` (the face's, if absent). */
  triangle(
    points: [Vec3, Vec3, Vec3],
    uvs: [Uv, Uv, Uv],
    normal: Vec3,
    normals?: [Vec3, Vec3, Vec3],
    group = 0,
  ): void {
    const [a, b, c] = points;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const facing =
      (u[1]! * v[2]! - u[2]! * v[1]!) * normal[0] +
      (u[2]! * v[0]! - u[0]! * v[2]!) * normal[1] +
      (u[0]! * v[1]! - u[1]! * v[0]!) * normal[2];
    const order = facing >= 0 ? [0, 1, 2] : [0, 2, 1];
    const start = this.positions.length / 3;
    for (const i of order) {
      this.positions.push(...points[i]!);
      this.normals.push(...(normals ? normals[i]! : normal));
      this.uvs.push(...uvs[i]!);
    }
    const last = this.groups.at(-1);
    if (last && last.group === group && last.start + last.count === start) last.count += 3;
    else this.groups.push({ start, count: 3, group });
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    // Material groups only where there is more than one: a single-material part stays one draw.
    if (this.groups.some((group) => group.group !== 0)) {
      for (const { start, count, group } of this.groups) geometry.addGroup(start, count, group);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/**
 * A section extruded along the grain axis `g` from `from` to `to`, the section drawn in the (p, q)
 * plane anticlockwise. `endCut(a, b)` pulls each end's vertex back towards the middle by that much,
 * which is how a rafter's tail is cut; it must be linear in (a, b) so each end stays a plane.
 */
function prism(
  builder: Builder,
  { g, p, q }: { g: 0 | 1 | 2; p: 0 | 1 | 2; q: 0 | 1 | 2 },
  {
    section,
    from,
    to,
    offset: [du, dv],
    smooth = false,
    endCut,
    caps = 'both',
    group = 0,
  }: {
    section: Point2[];
    from: number;
    to: number;
    offset: Uv;
    smooth?: boolean;
    endCut?: (a: number, b: number) => number;
    caps?: 'both' | 'top';
    group?: number;
  },
): void {
  const at = (a: number, b: number, along: number): Vec3 => {
    const point: Vec3 = [0, 0, 0];
    point[p] = a;
    point[q] = b;
    point[g] = along;
    return point;
  };
  const inPlane = (a: number, b: number): Vec3 => {
    const vector: Vec3 = [0, 0, 0];
    vector[p] = a;
    vector[q] = b;
    return normalise(vector);
  };
  const cut = (a: number, b: number) => endCut?.(a, b) ?? 0;
  const low = (point: Point2) => from + cut(point[0], point[1]);
  const high = (point: Point2) => to - cut(point[0], point[1]);

  // Each edge's outward normal in the section plane: (db, −da) for an anticlockwise section.
  const n = section.length;
  const edgeNormals = section.map((point, i) => {
    const next = section[(i + 1) % n]!;
    return inPlane(next[1] - point[1], -(next[0] - point[0]));
  });
  const vertexNormals = section.map((_, i) => {
    const before = edgeNormals[(i + n - 1) % n]!;
    const after = edgeNormals[i]!;
    return normalise([before[0] + after[0], before[1] + after[1], before[2] + after[2]]);
  });

  // The long faces, V running on round the section.
  let around = 0;
  for (let i = 0; i < n; i += 1) {
    const a = section[i]!;
    const b = section[(i + 1) % n]!;
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const corners: Vec3[] = [
      at(a[0], a[1], low(a)),
      at(b[0], b[1], low(b)),
      at(b[0], b[1], high(b)),
      at(a[0], a[1], high(a)),
    ];
    const uv: Uv[] = [
      [du + low(a) - from, dv + around],
      [du + low(b) - from, dv + around + width],
      [du + high(b) - from, dv + around + width],
      [du + high(a) - from, dv + around],
    ];
    const face = edgeNormals[i]!;
    const normals = smooth
      ? ([
          vertexNormals[i]!,
          vertexNormals[(i + 1) % n]!,
          vertexNormals[(i + 1) % n]!,
          vertexNormals[i]!,
        ] as const)
      : null;
    builder.triangle(
      [corners[0]!, corners[1]!, corners[2]!],
      [uv[0]!, uv[1]!, uv[2]!],
      face,
      normals ? [normals[0], normals[1], normals[2]] : undefined,
      group,
    );
    builder.triangle(
      [corners[0]!, corners[2]!, corners[3]!],
      [uv[0]!, uv[2]!, uv[3]!],
      face,
      normals ? [normals[0], normals[2], normals[3]] : undefined,
      group,
    );
    around += width;
  }

  // The ends: a fan over the (convex) section, each laid flat in the cross-section's metres.
  const ends: [1 | -1, (point: Point2) => number][] =
    caps === 'both'
      ? [
          [1, high],
          [-1, low],
        ]
      : [[1, high]];
  for (const [sign, along] of ends) {
    const points = section.map((point) => at(point[0], point[1], along(point)));
    const normal = capNormal(points, g, sign);
    const uv = (point: Point2): Uv => [du + point[0], dv + point[1]];
    for (let i = 1; i < n - 1; i += 1) {
      builder.triangle(
        [points[0]!, points[i]!, points[i + 1]!],
        [uv(section[0]!), uv(section[i]!), uv(section[i + 1]!)],
        normal,
        undefined,
        group,
      );
    }
  }
}

/** A planar end cap's normal (Newell's method), turned to point `sign` along the grain. */
function capNormal(points: Vec3[], g: 0 | 1 | 2, sign: 1 | -1): Vec3 {
  const normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const unit = normalise(normal);
  return unit[g] * sign >= 0 ? unit : [-unit[0], -unit[1], -unit[2]];
}

/* ---------------------------------------------------------------- the hipped roof */

/**
 * A four-sided hipped roof on a `base` footprint, from the eaves at y = 0 to an apex at `rise`, and
 * the soffit underneath — a gazebo's roof is looked up at from inside as often as down on.
 */
function pyramidGeometry(
  [width, depth]: [number, number],
  rise: number,
  [du, dv]: Uv,
): BufferGeometry {
  const builder = new Builder();
  const hw = width / 2;
  const hd = depth / 2;
  const apex: Vec3 = [0, rise, 0];
  const corners: Vec3[] = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
  ];

  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const eave = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const mid: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
    const slope = Math.hypot(mid[0], rise, mid[2]);
    // The plane's outward normal: along the eave's outward horizontal, tipped up by the pitch.
    const out = Math.hypot(mid[0], mid[2]);
    const normal: Vec3 =
      out > 0 ? normalise([(mid[0] / out) * rise, out, (mid[2] / out) * rise]) : [0, 1, 0];
    builder.triangle(
      [a, b, apex],
      [
        [du, dv],
        [du + eave, dv],
        [du + eave / 2, dv + slope],
      ],
      normal,
    );
  }

  // The soffit.
  const soffit = (point: Vec3): Uv => [du + point[0] + hw, dv + point[2] + hd];
  builder.triangle(
    [corners[0]!, corners[1]!, corners[2]!],
    [soffit(corners[0]!), soffit(corners[1]!), soffit(corners[2]!)],
    [0, -1, 0],
  );
  builder.triangle(
    [corners[0]!, corners[2]!, corners[3]!],
    [soffit(corners[0]!), soffit(corners[2]!), soffit(corners[3]!)],
    [0, -1, 0],
  );
  return builder.geometry();
}

function normalise([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
