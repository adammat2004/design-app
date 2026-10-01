import type { LocalPoint } from '@garden-studio/schema';

/**
 * Where a furniture model goes: fitted into its piece's footprint by one uniform scale, turned so its
 * front faces the front of the footprint, and stood on its base.
 *
 * The model convention is the AR document's — pivot at the base's centre, +Y up, front towards +Z —
 * and the footprint's is `furniture-layout.ts`'s: width along the ring's first side, depth along its
 * last, the set's back at the far end of the depth. So the model's +Z is turned to point back along
 * the depth, towards the front.
 *
 * - **One scale, never three.** A model stretched to a footprint's proportions is a different piece of
 *   furniture: a chair twice as deep is not a chair. The scale is the largest at which the model's
 *   plan fits, and the element keeps the ground it measured.
 * - **A turn, never a mirror.** The yaw is read off the depth direction with `atan2`, so it is always
 *   a rotation; a mirrored chair would put its back on the wrong side and nothing would say so.
 * - **The wrong model is refused, not squeezed.** Outside `FIT_BAND` the scale is saying the model is
 *   not this piece — a stool fitted to a sofa's footprint — and the caller draws the boxes instead.
 */
export const FIT_BAND = { min: 0.75, max: 1.33 } as const;

export type ModelPlacement = {
  position: [number, number, number];
  /** Radians about +Y. */
  yaw: number;
  scale: number;
};

export function fitToFootprint(
  natural: readonly [number, number, number],
  ring: readonly LocalPoint[],
  base: number,
): ModelPlacement | null {
  if (ring.length !== 4) return null;
  const [p0, p1, , p3] = ring as [LocalPoint, LocalPoint, LocalPoint, LocalPoint];
  const width = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const depth = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  if (width < 1e-6 || depth < 1e-6 || natural[0] <= 0 || natural[2] <= 0) return null;
  const scale = Math.min(width / natural[0], depth / natural[2]);
  if (scale < FIT_BAND.min || scale > FIT_BAND.max) return null;
  // The depth runs from the front (the ring's first side) to the back; the model's front faces −v.
  const v = { x: (p3.x - p0.x) / depth, z: (p3.z - p0.z) / depth };
  // A turn about +Y by θ takes +Z to (sin θ, cos θ): set that to −v.
  const yaw = Math.atan2(-v.x, -v.z);
  // The middle of a rectangle is the middle of either diagonal.
  const centre = { x: (p1.x + p3.x) / 2, z: (p1.z + p3.z) / 2 };
  return { position: [centre.x, base, centre.z], yaw, scale };
}
