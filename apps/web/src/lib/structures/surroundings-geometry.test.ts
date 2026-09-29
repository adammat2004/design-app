import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import type { LocalPoint } from '@garden-studio/schema';
import {
  extrudedGeometry,
  furnitureParts,
  roofGeometry,
  surfaceColour,
  surfaceGeometry,
  surfaceTexture,
  tiledUv,
} from './surroundings-geometry';

type V = [number, number, number];

function triangles(geometry: BufferGeometry): V[][] {
  const position = geometry.getAttribute('position');
  const out: V[][] = [];
  for (let i = 0; i < position.count; i += 3) {
    out.push(
      [0, 1, 2].map((k) => [
        position.getX(i + k),
        position.getY(i + k),
        position.getZ(i + k),
      ]) as V[],
    );
  }
  return out;
}

function normalOf([a, b, c]: V[]): V {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
}

function areaOf(triangle: V[]): number {
  const n = normalOf(triangle);
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

/** An L, concave, running either way round. */
const L: LocalPoint[] = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 2 },
  { x: 2, z: 2 },
  { x: 2, z: 4 },
  { x: 0, z: 4 },
];

describe('surfaceGeometry', () => {
  it('covers exactly the ring’s area, facing up, whichever way the ring runs', () => {
    for (const ring of [L, [...L].reverse()]) {
      const geometry = surfaceGeometry(ring, 0.01, tiledUv(1, 1))!;
      const tris = triangles(geometry);
      expect(tris.reduce((sum, triangle) => sum + areaOf(triangle), 0)).toBeCloseTo(12);
      for (const triangle of tris) {
        expect(normalOf(triangle)[1]).toBeGreaterThan(0);
        for (const vertex of triangle) expect(vertex[1]).toBeCloseTo(0.01);
      }
    }
  });

  /** A shape built through `ShapeGeometry` and a turn about X lands mirrored front to back. */
  it('keeps a point that is in front of the structure in front of it', () => {
    const ahead: LocalPoint[] = [
      { x: -1, z: 3 },
      { x: 1, z: 3 },
      { x: 1, z: 5 },
      { x: -1, z: 5 },
    ];
    const zs = triangles(surfaceGeometry(ahead, 0, tiledUv(1, 1))!)
      .flat()
      .map((vertex) => vertex[2]);
    expect(Math.min(...zs)).toBeCloseTo(3);
    expect(Math.max(...zs)).toBeCloseTo(5);
  });

  it('tiles in metres each way, so a long board is not drawn square', () => {
    const geometry = surfaceGeometry(L, 0, tiledUv(3.6, 0.145))!;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i += 1) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 3.6);
      expect(uv.getY(i)).toBeCloseTo(-position.getZ(i) / 0.145);
    }
  });

  it('stands paving up as a slab with an edge, its top where it was asked for', () => {
    const tris = triangles(surfaceGeometry(L, 0.03, tiledUv(1, 1), 0.03)!);
    const ys = tris.flat().map((vertex) => vertex[1]);
    expect(Math.max(...ys)).toBeCloseTo(0.03);
    expect(Math.min(...ys)).toBeCloseTo(0);
    // The edges face sideways; the top still faces up.
    expect(tris.some((triangle) => Math.abs(normalOf(triangle)[1]) < 1e-9)).toBe(true);
  });

  it('draws nothing for a ring with no area', () => {
    expect(
      surfaceGeometry(
        [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
          { x: 2, z: 0 },
        ],
        0,
        tiledUv(1, 1),
      ),
    ).toBeNull();
  });
});

describe('extrudedGeometry', () => {
  it('stands a footprint up with every wall facing out and the cap facing up', () => {
    for (const ring of [L, [...L].reverse()]) {
      const tris = triangles(extrudedGeometry(ring, 0.2, 1.8)!);
      const ys = tris.flat().map((vertex) => vertex[1]);
      expect(Math.min(...ys)).toBeCloseTo(0.2);
      expect(Math.max(...ys)).toBeCloseTo(2);
      for (const triangle of tris) {
        const n = normalOf(triangle);
        if (Math.abs(n[1]) > 1e-9) {
          expect(n[1]).toBeGreaterThan(0);
          continue;
        }
        // A wall: its normal points away from the inside of the L, probed just behind the face.
        const mid = triangle.reduce((acc, v) => [acc[0] + v[0] / 3, 0, acc[2] + v[2] / 3], [
          0, 0, 0,
        ] as V);
        const length = Math.hypot(n[0], n[2]);
        const behind = { x: mid[0] - (n[0] / length) * 0.01, z: mid[2] - (n[2] / length) * 0.01 };
        const inside =
          behind.x > 0 &&
          behind.z > 0 &&
          behind.x < 4 &&
          behind.z < 4 &&
          (behind.x < 2 || behind.z < 2);
        expect(inside).toBe(true);
      }
    }
  });
});

describe('roofGeometry', () => {
  const house: LocalPoint[] = [
    { x: -4, z: -3 },
    { x: 4, z: -3 },
    { x: 4, z: 3 },
    { x: -4, z: 3 },
  ];

  it('raises the ridge above the eaves and keeps the eaves at the walls’ height', () => {
    const { roof } = roofGeometry(house, 6)!;
    const ys = triangles(roof)
      .flat()
      .map((vertex) => vertex[1]);
    expect(Math.min(...ys)).toBeCloseTo(6);
    expect(Math.max(...ys)).toBeCloseTo(6 + 6 * 0.35);
    for (const triangle of triangles(roof)) expect(normalOf(triangle)[1]).toBeGreaterThan(0);
  });

  it('roofs an L-shaped house without a hole or a fold', () => {
    const built = roofGeometry(
      L.map((point) => ({ x: point.x * 3, z: point.z * 3 })),
      3,
    )!;
    const tris = triangles(built.roof);
    for (const triangle of tris) expect(normalOf(triangle)[1]).toBeGreaterThan(0);
    // The roof's plan area is the house's own, so nothing is missing and nothing is doubled.
    const planArea = tris.reduce((sum, triangle) => sum + Math.abs(normalOf(triangle)[1]) / 2, 0);
    expect(planArea).toBeCloseTo(12 * 9, 1);
  });

  it('closes a gable’s ends with wall', () => {
    const long: LocalPoint[] = [
      { x: -8, z: -2 },
      { x: 8, z: -2 },
      { x: 8, z: 2 },
      { x: -8, z: 2 },
    ];
    const built = roofGeometry(long, 3)!;
    expect(built.gables).not.toBeNull();
    expect(triangles(built.gables!)).toHaveLength(2);
  });
});

describe('what a surface is drawn with', () => {
  it('finds the plan’s own texture and its size, and says so when there is none', () => {
    const turf = surfaceTexture('standard-turf');
    expect(turf?.url).toMatch(/^\/assets\/.*tex-standard-turf-1\.webp$/);
    expect(turf?.tile.u).toBeGreaterThan(0);
    // A decking board's picture is long and thin, and says so.
    const deck = surfaceTexture('timber-decking');
    expect(deck!.tile.u).toBeGreaterThan(deck!.tile.v * 5);
    expect(surfaceTexture('no-such-material')).toBeNull();
    // A unit's face before the ground between: stepping stones are stone, not a lawn.
    expect(surfaceTexture('stepping-stones')?.url).toMatch(/face-stepping-stone/);
    expect(surfaceTexture(null)).toBeNull();
  });

  it('falls back to the plan’s flat colour', () => {
    expect(surfaceColour('standard-turf', 'lawn')).toMatch(/^#/);
    expect(surfaceColour(null, 'paved-area')).toMatch(/^#/);
  });
});

describe('furnitureParts', () => {
  const square: LocalPoint[] = [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];
  const inside = (parts: ReturnType<typeof furnitureParts>, height: number) => {
    for (const part of parts) {
      expect(part.base).toBeGreaterThanOrEqual(0);
      expect(part.base + part.height).toBeLessThanOrEqual(height + 1e-9);
      for (const point of part.ring) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(point.z)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  };

  it('draws a dining set as a table on legs with its chairs round it, not as a block', () => {
    const four = furnitureParts('dining-set-4', square, 0, 0.75);
    const six = furnitureParts('dining-set-6', square, 0, 0.75);
    // A top, four legs, and a seat, a pad and a back for each chair.
    expect(four).toHaveLength(1 + 4 + 4 * 3);
    expect(six).toHaveLength(1 + 4 + 6 * 3);
    expect(four.some((part) => part.cushion)).toBe(true);
    inside(four, 0.9);
  });

  it('draws a lounge set as a sofa with a back and arms, and a low table in front', () => {
    const parts = furnitureParts('sofa-set', square, 0, 0.8);
    expect(parts.length).toBeGreaterThanOrEqual(6);
    inside(parts, 0.9);
  });

  it('draws a parasol as a pole under a canopy, and anything else as its block', () => {
    const parasol = furnitureParts('parasol', square, 0, 2.4);
    expect(parasol).toHaveLength(2);
    inside(parasol, 2.4);
    expect(furnitureParts('planter', square, 0, 0.9)).toEqual([
      { ring: square, base: 0, height: 0.9 },
    ]);
  });
});
