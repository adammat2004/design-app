/**
 * The drawing's tilt, alone, importing nothing.
 *
 * What is left of the retired Visualise camera (Sep 2026). The plan still uses the lift in two small
 * places — a plant sprite is drawn half its height up the screen so it reads as standing, and an
 * edging course that stands proud shows a face a pixel or two tall — and both take it from here so
 * they agree. `projection.ts` re-exports both names, so nothing in the renderer has to know this
 * file exists. It stays a leaf with no imports, the reason `zone-id.ts` is one.
 */

/**
 * The camera's tilt from vertical, in degrees.
 *
 * Twelve is shallow enough that the drawing still reads as a plan: the lift it gives a plant or a
 * kerb is a hint of height, never a face that hides the ground behind it. Changing it moves every
 * plant sprite on the plan, so the goldens will say so.
 */
export const CAMERA_TILT_DEGREES = 12;

/**
 * Metres up the screen per metre of height. `tan(12°)` — what the tilt means, not a tuned number.
 */
export const RISE = Math.tan((CAMERA_TILT_DEGREES * Math.PI) / 180);
