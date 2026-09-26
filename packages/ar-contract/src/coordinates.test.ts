import { rectToPolygon } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import {
  planDegreesFromYaw,
  planToScene,
  rotateAboutY,
  sceneToPlan,
  yawFromPlanDegrees,
  type Vec2,
} from './coordinates.js';

/**
 * The convention in one test: a rotated rectangle drawn by the plan's own `rectToPolygon` must
 * land exactly where an engine puts a box turned by `yawFromPlanDegrees`. If this ever fails, a
 * renderer is about to draw every rotated patio, shed and table mirrored or turned the wrong way.
 */
describe('plan → scene', () => {
  const origin = { x: 4, y: 7 };

  it('is a translation, with the plan height becoming Y', () => {
    expect(planToScene({ x: 6, y: 10 }, origin, 2.4)).toEqual([2, 2.4, 3]);
    expect(sceneToPlan([2, 2.4, 3], origin)).toEqual({ x: 6, y: 10 });
    expect(sceneToPlan([2, 3], origin)).toEqual({ x: 6, y: 10 });
  });

  it.each([0, 15, 30, 90, 137, 180, 270, -45])(
    'a rect rotated %s° in the plan is a box turned by yawFromPlanDegrees',
    (rotation) => {
      const rect = { centre: { x: 9, y: 12 }, width: 3.6, depth: 2.4, rotation };
      const planCorners = rectToPolygon(rect).map((corner) => planToScene(corner, origin));

      const yaw = yawFromPlanDegrees(rotation);
      const centre = planToScene(rect.centre, origin);
      const unrotated: Vec2[] = rectToPolygon({ ...rect, rotation: 0 }).map((corner) => [
        corner.x - rect.centre.x,
        corner.y - rect.centre.y,
      ]);
      const engineCorners = unrotated.map((local) => {
        const [x, z] = rotateAboutY(local, yaw);
        return [centre[0] + x, 0, centre[2] + z];
      });

      engineCorners.forEach((corner, index) => {
        expect(corner[0]).toBeCloseTo(planCorners[index]![0], 9);
        expect(corner[2]).toBeCloseTo(planCorners[index]![2], 9);
      });
    },
  );

  it('a positive plan rotation is a negative yaw, and back again', () => {
    expect(yawFromPlanDegrees(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(planDegreesFromYaw(yawFromPlanDegrees(37))).toBeCloseTo(37, 12);
    expect(Object.is(yawFromPlanDegrees(0), 0)).toBe(true);
  });

  it('is not mirrored: plan right-then-down stays right-then-down seen from above', () => {
    // +x right and +y down the page become +X and +Z; seen from +Y with X to the right, +Z is
    // down the page. A mirrored mapping would send one of them the other way.
    const right = planToScene({ x: origin.x + 1, y: origin.y }, origin);
    const down = planToScene({ x: origin.x, y: origin.y + 1 }, origin);
    expect(right).toEqual([1, 0, 0]);
    expect(down).toEqual([0, 0, 1]);
    // X × Y = Z for a right-handed frame.
    const cross = [0 * 0 - 0 * 1, 0 * 0 - 1 * 0, 1 * 1 - 0 * 0];
    expect(cross).toEqual([0, 0, 1]);
  });
});
