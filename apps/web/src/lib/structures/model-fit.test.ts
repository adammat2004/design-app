import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import type { LocalPoint } from '@garden-studio/schema';
import { FIT_BAND, fitToFootprint } from './model-fit';

/** A w × d footprint turned by `deg`, its first side along the width, as `pieceBox` reads it. */
function footprint(w: number, d: number, deg: number, at = { x: 1, z: -2 }): LocalPoint[] {
  const t = (deg * Math.PI) / 180;
  const u = { x: Math.cos(t), z: Math.sin(t) };
  const v = { x: -Math.sin(t), z: Math.cos(t) };
  const corner = (a: number, b: number) => ({
    x: at.x + u.x * (a - w / 2) + v.x * (b - d / 2),
    z: at.z + u.z * (a - w / 2) + v.z * (b - d / 2),
  });
  return [corner(0, 0), corner(w, 0), corner(w, d), corner(0, d)];
}

function placed(natural: [number, number, number], ring: LocalPoint[]) {
  const fit = fitToFootprint(natural, ring, 0.04)!;
  const matrix = new Matrix4()
    .makeTranslation(...fit.position)
    .multiply(new Matrix4().makeRotationY(fit.yaw))
    .multiply(new Matrix4().makeScale(fit.scale, fit.scale, fit.scale));
  return { fit, matrix };
}

describe('fitToFootprint', () => {
  for (const deg of [0, 90, 37]) {
    it(`fits a model inside a footprint turned ${deg}°, uniformly, front to the front, unmirrored`, () => {
      const ring = footprint(1.6, 0.6, deg);
      const { fit, matrix } = placed([1.165, 0.89, 0.497], ring);
      expect(fit.scale).toBeCloseTo(0.6 / 0.497, 9);
      expect(fit.position[1]).toBe(0.04);
      // Every corner of the model's plan lands inside the footprint.
      const [p0, p1, , p3] = ring as [LocalPoint, LocalPoint, LocalPoint, LocalPoint];
      const u = new Vector3(p1.x - p0.x, 0, p1.z - p0.z);
      const v = new Vector3(p3.x - p0.x, 0, p3.z - p0.z);
      for (const [x, z] of [
        [-0.5825, -0.2485],
        [0.5825, -0.2485],
        [0.5825, 0.2485],
        [-0.5825, 0.2485],
      ] as const) {
        const point = new Vector3(x, 0, z).applyMatrix4(matrix).sub(new Vector3(p0.x, 0.04, p0.z));
        const a = point.dot(u) / u.lengthSq();
        const b = point.dot(v) / v.lengthSq();
        expect(a).toBeGreaterThanOrEqual(-1e-9);
        expect(a).toBeLessThanOrEqual(1 + 1e-9);
        expect(b).toBeGreaterThanOrEqual(-1e-9);
        expect(b).toBeLessThanOrEqual(1 + 1e-9);
      }
      // The model's front (+Z) looks towards the footprint's front, away from its back.
      const front = new Vector3(0, 0, 1).transformDirection(matrix);
      expect(front.dot(v.normalize())).toBeCloseTo(-1, 9);
      // A rotation and a positive scale: never a mirror.
      expect(matrix.determinant()).toBeGreaterThan(0);
    });
  }

  it('refuses a model the scale says is the wrong piece, and a footprint that is not a rectangle', () => {
    expect(fitToFootprint([0.4, 0.5, 0.4], footprint(1.6, 0.6, 0), 0)).toBeNull();
    expect(fitToFootprint([3, 0.8, 1.2], footprint(1.6, 0.6, 0), 0)).toBeNull();
    expect(fitToFootprint([1.6, 0.8, 0.6], footprint(1.6, 0.6, 0).slice(0, 3), 0)).toBeNull();
    const fit = fitToFootprint([2.4, 0.95, 2.4], footprint(2.4, 2.4, 12), 0)!;
    expect(fit.scale).toBeCloseTo(1, 9);
    expect(FIT_BAND.min).toBeLessThan(1);
    expect(FIT_BAND.max).toBeGreaterThan(1);
  });
});
