/**
 * The camera angle, alone, importing nothing.
 *
 * ## Why this is its own file
 *
 * Two things need this number and they live on opposite sides of the repository. `projection.ts`
 * needs it to draw; `asset-spec.ts` needs it because the elevated asset library is *photographed*
 * at this angle, and its prompt says so in words. They must agree or a photographed sofa stands at
 * a different attitude from the shed drawn beside it.
 *
 * `asset-spec.ts` is also imported directly, by relative path, by `tools/assets` — a separate
 * package with `tsx`, `sharp` and nothing else, which cannot resolve `@garden-studio/schema`. So
 * the constant cannot live in a module that imports the schema, and `projection.ts` does. A leaf
 * with no imports at all is the answer, for the same reason `zone-id.ts` and `opening.ts` are leaves
 * in the schema package: one fact, reachable from both sides, with nothing behind it to resolve.
 *
 * `projection.ts` re-exports both names, so nothing in the renderer has to know this file exists.
 */

/**
 * The camera's tilt from vertical, in degrees.
 *
 * Twelve is shallow enough that the drawing still reads as a plan — a 6 m house lifts about a
 * seventh of its own depth up the screen — and steep enough to show what the brief asks for: a
 * 1.8 m fence shows a 38 cm face, a 2.3 m shed shows 49 cm of front wall. Past roughly 20° the
 * faces begin hiding the ground behind them and it stops being a plan.
 *
 * Stated in words in the `ELEVATED` prompt in `asset-spec.ts`. Changing it here means regenerating
 * the elevated library; that is not a reason never to change it, but it is a reason to change it
 * deliberately.
 */
export const CAMERA_TILT_DEGREES = 12;

/**
 * Metres up the screen per metre of height. `tan(12°)` — what the tilt means, not a tuned number.
 */
export const RISE = Math.tan((CAMERA_TILT_DEGREES * Math.PI) / 180);
