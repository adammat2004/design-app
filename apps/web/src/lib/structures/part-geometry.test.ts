import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  resolveStructure,
  STRUCTURE_DEFINITIONS,
  structureParts,
  type DesignElement,
  type FrameModel,
  type StructurePart,
} from '@garden-studio/schema';
import {
  EASE_METAL,
  EASE_TIMBER,
  RAFTER_TAIL,
  SHOE_HEIGHT,
  grainAxis,
  grainOffset,
  partGeometry,
} from './part-geometry';

const element = (over: Partial<DesignElement>): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Pergola',
  symbol: 'pergola',
  material: 'hardwood',
  zone: 'back',
  height: 2.4,
  shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 3.6, depth: 3.6, rotation: 0 },
  ...over,
});

/** Every configuration a pergola or a gazebo can be in, at sizes across its range. */
type Configuration = { label: string; model: FrameModel; parts: StructurePart[] };

function everyConfiguration(): Configuration[] {
  const out: Configuration[] = [];
  const sizes = [
    [1.8, 1.8, 2.1],
    [3.6, 2.4, 2.4],
    [6, 4.2, 3.2],
    [2.2, 5, 2.8],
  ] as const;
  for (const symbol of ['pergola', 'gazebo'] as const) {
    const definition = STRUCTURE_DEFINITIONS[symbol]!;
    for (const [width, depth, height] of sizes) {
      for (const preset of definition.presets) {
        for (const { id: kind } of definition.roof!.kinds) {
          const resolved = resolveStructure(
            element({
              symbol,
              height,
              shape: { kind: 'rect', centre: { x: 0, y: 0 }, width, depth, rotation: 0 },
              structure: {
                preset: preset.id,
                roof: { kind },
                sides: { left: 'slatted', right: 'slatted', rear: 'slatted' },
                lighting: true,
              },
            }),
          )!;
          out.push({
            label: `${symbol} ${preset.id} ${kind} ${width}x${depth}x${height}`,
            model: resolved.model,
            parts: structureParts(resolved),
          });
        }
      }
    }
  }
  return out;
}

type Triangle = { points: number[][]; uvs: number[][]; normals: number[][]; group: number };

function trianglesOf(geometry: BufferGeometry): Triangle[] {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  const groupOf = (index: number) =>
    geometry.groups.find((group) => index >= group.start && index < group.start + group.count)
      ?.materialIndex ?? 0;
  const out: Triangle[] = [];
  for (let i = 0; i < position.count; i += 3) {
    out.push({
      points: [0, 1, 2].map((k) => [
        position.getX(i + k),
        position.getY(i + k),
        position.getZ(i + k),
      ]),
      uvs: [0, 1, 2].map((k) => [uv.getX(i + k), uv.getY(i + k)]),
      normals: [0, 1, 2].map((k) => [normal.getX(i + k), normal.getY(i + k), normal.getZ(i + k)]),
      group: groupOf(i),
    });
  }
  return out;
}

const triangles = (part: StructurePart, model: FrameModel = 'classic') =>
  trianglesOf(partGeometry(part, { model }));

const cross = (a: number[], b: number[], c: number[]) => {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
};
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

const box = (
  id: string,
  group: StructurePart['group'],
  finish: StructurePart['finish'],
  size: [number, number, number],
): StructurePart => ({
  id,
  group,
  finish,
  shape: { kind: 'box', centre: [0, 0, 0], size },
});

describe('partGeometry', () => {
  it('stays inside the box its part names, in every configuration, so the footprint holds', () => {
    for (const { label, model, parts } of everyConfiguration()) {
      for (const part of parts) {
        const box = partGeometry(part, { model }).boundingBox!;
        const [hx, hy, hz] =
          part.shape.kind === 'box'
            ? part.shape.size.map((side) => side / 2)
            : [part.shape.base[0] / 2, part.shape.rise, part.shape.base[1] / 2];
        const low = part.shape.kind === 'box' ? -hy! : 0;
        expect(box.min.x, `${label} ${part.id}`).toBeGreaterThanOrEqual(-hx! - 1e-6);
        expect(box.max.x, `${label} ${part.id}`).toBeLessThanOrEqual(hx! + 1e-6);
        expect(box.min.z, `${label} ${part.id}`).toBeGreaterThanOrEqual(-hz! - 1e-6);
        expect(box.max.z, `${label} ${part.id}`).toBeLessThanOrEqual(hz! + 1e-6);
        expect(box.min.y, `${label} ${part.id}`).toBeGreaterThanOrEqual(low - 1e-6);
        expect(box.max.y, `${label} ${part.id}`).toBeLessThanOrEqual(hy! + 1e-6);
      }
    }
  });

  it('winds every face the way it is shaded, and out of the solid it belongs to', () => {
    for (const { label, model, parts } of everyConfiguration().slice(0, 16)) {
      for (const part of parts) {
        const geometry = partGeometry(part, { model });
        const all = trianglesOf(geometry);
        // A post in its shoe is two solids — the shoe and the timber above it — so each face is tested
        // against the middle of its own; everything else is one convex solid round the part's centre.
        const middleOf = (group: number): number[] => {
          const ys = all
            .filter((t) => t.group === group)
            .flatMap((t) => t.points.map((point) => point[1]!));
          const xs = all
            .filter((t) => t.group === group)
            .flatMap((t) => t.points.map((point) => point[0]!));
          const zs = all
            .filter((t) => t.group === group)
            .flatMap((t) => t.points.map((point) => point[2]!));
          const mid = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
          return [mid(xs), mid(ys), mid(zs)];
        };
        const middles = new Map([0, 1].map((group) => [group, middleOf(group)]));
        for (const { points, normals, group } of all) {
          const [a, b, c] = points as [number[], number[], number[]];
          const n = cross(a, b, c);
          const shaded = normals.reduce(
            (sum, normal) => sum.map((value, k) => value + normal[k]!),
            [0, 0, 0],
          );
          expect(dot(n, shaded), `${label} ${part.id}`).toBeGreaterThan(0);
          const centroid = [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3);
          const inside =
            part.shape.kind === 'box' ? middles.get(group)! : [0, part.shape.rise / 4, 0];
          expect(
            dot(
              n,
              centroid.map((value, k) => value - inside[k]!),
            ),
            `${label} ${part.id}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lays the grain along the long side, one texture metre to one metre of timber', () => {
    const rafter: StructurePart = {
      id: 'rafter-3',
      group: 'rafter',
      finish: 'hardwood',
      shape: { kind: 'box', centre: [0, 2.3, 0], size: [0.075, 0.15, 3.6] },
    };
    expect(grainAxis(rafter.shape.kind === 'box' ? rafter.shape.size : [0, 0, 0])).toBe(2);
    // On a long face, the U span is the rafter's length and the V span its section.
    const long = triangles(rafter).filter(({ points }) => {
      const zs = points.map((point) => point[2]!);
      return Math.max(...zs) - Math.min(...zs) > 1;
    });
    // Eight faces round an eased section, two triangles each.
    expect(long.length).toBe(16);
    const us = long.flatMap(({ uvs }) => uvs.map((uv) => uv[0]!));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3.6, 6);
    for (const { points, uvs } of long) {
      // U follows z exactly: the grain runs along the rafter.
      const zToU = points.map((point, k) => uvs[k]![0]! - point[2]!);
      for (const value of zToU) expect(value).toBeCloseTo(zToU[0]!, 6);
    }
  });

  it('starts each part at its own place along the texture, and the same place every build', () => {
    expect(grainOffset('rafter-1')).toEqual(grainOffset('rafter-1'));
    expect(grainOffset('rafter-1')).not.toEqual(grainOffset('rafter-2'));
    const [u, v] = grainOffset('post-0');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(3);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('keeps even the largest configuration well inside the hero budget of 15k triangles', () => {
    const worst = Math.max(
      ...everyConfiguration().map(({ parts }) =>
        parts.reduce((sum, part) => sum + partGeometry(part).getAttribute('position').count / 3, 0),
      ),
    );
    expect(worst).toBeLessThan(15_000);
  });

  it('eases timber edges by 4 mm, metal by 2 mm, and leaves a panel square', () => {
    const extentAtCorner = (part: StructurePart) => {
      // How far the section reaches along the diagonal: a square corner reaches the full half-width.
      const xs = triangles(part).flatMap((t) =>
        t.points.filter((point) => Math.abs(point[1]!) > 0.07).map((point) => Math.abs(point[0]!)),
      );
      return Math.max(...xs);
    };
    const post = (finish: StructurePart['finish']) =>
      box('post-x', 'beam', finish, [0.15, 0.15, 3]);
    // At the top face (|y| at its maximum) the section stops short of the full half-width by the ease.
    const top = (part: StructurePart) =>
      Math.max(
        ...triangles(part).flatMap((t) =>
          t.points
            .filter((point) => Math.abs(point[1]! - 0.075) < 1e-6)
            .map((point) => Math.abs(point[0]!)),
        ),
      );
    expect(top(post('softwood'))).toBeCloseTo(0.075 - EASE_TIMBER, 6);
    expect(top(post('aluminium-dark'))).toBeCloseTo(0.075 - EASE_METAL, 6);
    expect(top(post('polycarbonate-opal'))).toBeCloseTo(0.075, 6);
    expect(extentAtCorner(post('softwood'))).toBeCloseTo(0.075, 6);
  });

  it('cuts a classic rafter’s tails on the top edge and leaves the underside its full length', () => {
    const rafter = box('rafter-2', 'rafter', 'softwood', [0.075, 0.15, 3.6]);
    const points = triangles(rafter, 'classic').flatMap((t) => t.points);
    const reach = (y: number) =>
      Math.max(
        ...points
          .filter((point) => Math.abs(point[1]! - y) < 1e-6)
          .map((point) => Math.abs(point[2]!)),
      );
    expect(reach(-0.075)).toBeCloseTo(1.8, 6);
    expect(reach(0.075)).toBeCloseTo(1.8 - RAFTER_TAIL, 6);
    // The same part under a modern frame is a blade, and nothing is cut off it.
    const blade = triangles(rafter, 'modern').flatMap((t) => t.points);
    expect(Math.max(...blade.map((point) => Math.abs(point[2]!)))).toBeCloseTo(1.8, 6);
  });

  it('draws a modern blade as a smooth aerofoil rather than a plank', () => {
    const blade = box('blade-0', 'rafter', 'aluminium-dark', [0.12, 0.03, 3]);
    const long = triangles(blade, 'modern').filter((t) => {
      const zs = t.points.map((point) => point[2]!);
      return Math.max(...zs) - Math.min(...zs) > 1;
    });
    // Smooth shading: the normals across one face are not all the same.
    const varied = long.some(({ normals }) =>
      normals.some((normal) => dot(normal, normals[0]!) < 0.999),
    );
    expect(varied).toBe(true);
    // And it is a lens: at the blade's full width it is thinner than at its middle.
    const points = long.flatMap((t) => t.points);
    const thicknessAt = (x: number) =>
      Math.max(
        ...points
          .filter((point) => Math.abs(point[0]! - x) < 0.02)
          .map((point) => Math.abs(point[1]!)),
      );
    expect(thicknessAt(0.055)).toBeLessThan(thicknessAt(0));
  });

  it('stands a timber post in a galvanised shoe inside its own box, and an aluminium one on its own', () => {
    const timber = partGeometry(box('post-0', 'post', 'hardwood', [0.15, 2.3, 0.15]));
    expect(timber.groups.map((group) => group.materialIndex).sort()).toEqual([0, 1]);
    const shoe = trianglesOf(timber)
      .filter((t) => t.group === 1)
      .flatMap((t) => t.points);
    expect(Math.min(...shoe.map((point) => point[1]!))).toBeCloseTo(-1.15, 6);
    expect(Math.max(...shoe.map((point) => point[1]!))).toBeCloseTo(-1.15 + SHOE_HEIGHT, 6);
    expect(Math.max(...shoe.map((point) => Math.abs(point[0]!)))).toBeCloseTo(0.075, 6);
    const metal = partGeometry(box('post-0', 'post', 'aluminium-dark', [0.12, 2.3, 0.12]));
    expect(metal.groups).toEqual([]);
  });
});
