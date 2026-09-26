/**
 * The one mapping between the plan and an AR scene. Read `docs/ar/ar-architecture.md` §
 * "Coordinates" before changing anything here.
 *
 * The plan (`packages/schema`, `geometry/primitives.ts`): metres, origin at the top-left of the
 * site, +x right, **+y down the screen**, rotations in **degrees clockwise** as seen on screen.
 * Heights are separate numbers — `elevation` is where a thing's base sits above grade.
 *
 * An AR scene: metres, **right-handed, +Y up** — the convention glTF, ARKit, ARCore and three.js
 * all share. The ground is the XZ plane.
 *
 *     plan (x, y) at height h   →   scene (X, Y, Z) = (x − origin.x, h, y − origin.y)
 *
 * With Y up, +X right and +Z pointing down the plan's page, the axes are right-handed and the
 * mapping is **not mirrored**: a plan drawn and the same garden in AR look the same from above,
 * not reflected. That is why the conversion is a translation and nothing else.
 *
 * Rotation is the one place a sign changes. A positive plan rotation turns clockwise as seen from
 * above; a positive rotation about +Y (right-hand rule) turns *anticlockwise* as seen from above.
 * So `yaw = −degrees × π / 180`. `coordinates.test.ts` pins this against the plan's own rotation
 * formula, and nothing else in the scene format carries an angle.
 */

/** A point on the ground in scene metres: `[X, Z]`. */
export type Vec2 = [x: number, z: number];
/** A point in scene metres: `[X, Y, Z]`, Y up. */
export type Vec3 = [x: number, y: number, z: number];

/** A point in plan metres, the shape `@garden-studio/schema` uses. */
export interface PlanPoint {
  x: number;
  y: number;
}

/** Plan metres (plus a height above grade) → scene metres, relative to the scene's origin. */
export function planToScene(point: PlanPoint, origin: PlanPoint, height = 0): Vec3 {
  return [point.x - origin.x, height, point.y - origin.y];
}

/** A plan point on the ground → scene `[X, Z]`. */
export function planToGround(point: PlanPoint, origin: PlanPoint): Vec2 {
  return [point.x - origin.x, point.y - origin.y];
}

/** Scene metres → plan metres. The height is dropped: the plan keeps it elsewhere. */
export function sceneToPlan(point: Vec2 | Vec3, origin: PlanPoint): PlanPoint {
  const z = point.length === 3 ? point[2] : point[1];
  return { x: point[0] + origin.x, y: z + origin.y };
}

/** A plan rotation (degrees clockwise on screen) → a scene yaw (radians about +Y). */
export function yawFromPlanDegrees(degrees: number): number {
  // `|| 0` turns the −0 that negating 0 produces into 0, so a scene carries `0` rather than `-0`.
  return -(degrees * Math.PI) / 180 || 0;
}

/** A scene yaw (radians about +Y) → a plan rotation (degrees clockwise on screen). */
export function planDegreesFromYaw(yaw: number): number {
  return -(yaw * 180) / Math.PI || 0;
}

/**
 * Rotates a scene point about +Y by `yaw` radians, the way every engine does:
 * `X' = X·cos θ + Z·sin θ`, `Z' = −X·sin θ + Z·cos θ`.
 *
 * Here so the test can show the convention holds, and so a renderer that needs to place something
 * without the engine's help does it the same way the engine will.
 */
export function rotateAboutY(point: Vec2, yaw: number): Vec2 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [point[0] * cos + point[1] * sin, -point[0] * sin + point[1] * cos];
}
