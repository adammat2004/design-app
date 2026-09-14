/**
 * The Visualise scene grade.
 *
 * One set of numbers, two applications, and a test that pins them to each other.
 *
 * **Why two applications.** Visualise on screen is two stacked DOM canvases — a WebGL one for the
 * ground, surfaces, shadows and planting, and a transparent 2D one over it for the house, the
 * fence, the objects and the night wash. Nothing draws both, so nothing can grade both; the only
 * element that contains them is the wrapper `div`, which takes `gradeCss()`. The judging sheets,
 * the PNG export and the concept thumbnails are the opposite case — one canvas, no DOM, no wrapper
 * — so they take `applyGrade`. A grade that existed only as CSS would be invisible to
 * `measure:render`, which would then report on an ungraded picture and tune us blind.
 *
 * **Why they can be made equal rather than merely similar.** The CSS shorthand filter functions are
 * specified operations, not vendor taste: `brightness(b)` is a linear transfer `C' = C · b`,
 * `contrast(c)` is `C' = C · c + (0.5 − 0.5c)`, and `saturate(s)` is a colour matrix built on the
 * same Rec. 709 luminance weights `export-plan.ts` already uses. They are defined over
 * **non-linear sRGB** for the CSS shorthand, which is what makes the arithmetic below a
 * replication rather than an approximation. `grade.test.ts` holds them to each other.
 *
 * ---
 *
 * **The numbers are measured, and the measurement reversed the brief that asked for them.**
 *
 * The design review specified "desaturate ~30%, lift luminance ~10%, expand contrast ~20%", from a
 * reading of `target_design.png` at 0.243 saturation against our 0.347. That comparison was not
 * like-for-like twice over: it measured the reference against *different gardens* than ours, and
 * `target_design.png` is a screenshot of an application whose near-white nav, palette and
 * properties panel dilute any crop that catches them.
 *
 * Measured inside the plot on both sides, with `fixtures/target.plan.json` — the reference traced
 * by hand, so the *same garden* — as the control:
 *
 *                        saturation   luminance   contrast
 *     target_design.png       0.334       0.422      0.190
 *     ours, same garden       0.338       0.464      0.177
 *     gap                     +1.1%      +10.0%      -6.7%
 *
 * So there is **no saturation gap at all**, and we are 10% *brighter* than the reference rather
 * than 11% darker. Desaturating by 30% and lifting luminance would have moved the render away from
 * the target on both axes while the original measurement applauded.
 *
 * What is left is small and real: come down about a tenth in brightness, open the contrast about a
 * fifteenth, leave the colour alone. `BRIGHTNESS` and `CONTRAST` below are solved for rather than
 * dialled — given `brightness` then `contrast` applied in that order, matching the mean and the
 * standard deviation of the control to the reference has exactly one solution.
 *
 * Re-derive rather than re-guess: `pnpm --filter @garden-studio/web measure:render` prints the
 * control row, and these numbers are correct when the gap row reads about zero on all three.
 */

/** Linear transfer. Below 1 because the control measured 10% brighter than the reference. */
export const BRIGHTNESS = 0.932;

/** Around mid-grey. Above 1 because the control measured 6.7% flatter than the reference. */
export const CONTRAST = 1.152;

/**
 * A compensation, not a correction — and the distinction is the whole reason this constant exists.
 *
 * The **raw** saturation gap is 1.1%, which is nothing: ungraded, we already match the reference on
 * colour. But `contrast()` pushes every channel away from mid-grey, and that widens `max − min`
 * faster than it moves `max`, so expanding the contrast enough to fix the flatness drags measured
 * saturation from 0.338 up to 0.408 on its own. This pulls it back down to where it already was.
 *
 * So the brief that asked for a 30% desaturation arrives at a similar-looking number by a
 * completely different route, and the difference matters: **delete `CONTRAST` and this must go back
 * to 1**, because there would be nothing left to compensate for. Tuning them independently is how
 * the render ends up grey.
 *
 * Applied last, and `saturate()` is a lerp toward luma, so it leaves `BRIGHTNESS` and `CONTRAST`
 * exactly where they landed — the three terms are solvable in sequence rather than jointly.
 */
export const SATURATION = 0.773;

/** Rec. 709, the same weights `export-plan.ts` uses, so a saturation change never shifts hue. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const EPSILON = 1e-6;

function isIdentity(): boolean {
  return (
    Math.abs(BRIGHTNESS - 1) < EPSILON &&
    Math.abs(CONTRAST - 1) < EPSILON &&
    Math.abs(SATURATION - 1) < EPSILON
  );
}

/**
 * The grade as a CSS `filter` value, for the Visualise wrapper.
 *
 * Identity terms are left out rather than written as `saturate(1)`: a filter list that is entirely
 * identity should be `none`, so the browser skips compositing the element into its own layer.
 */
export function gradeCss(): string {
  if (isIdentity()) return 'none';

  const parts: string[] = [];
  if (Math.abs(BRIGHTNESS - 1) >= EPSILON) parts.push(`brightness(${BRIGHTNESS})`);
  if (Math.abs(CONTRAST - 1) >= EPSILON) parts.push(`contrast(${CONTRAST})`);
  if (Math.abs(SATURATION - 1) >= EPSILON) parts.push(`saturate(${SATURATION})`);

  return parts.join(' ');
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * One pixel, in the order `gradeCss` writes the filter list.
 *
 * Exported for the equivalence test, which needs to drive exactly this and nothing around it.
 */
export function gradePixel(r: number, g: number, b: number): [number, number, number] {
  // brightness(): a linear transfer on each channel.
  let cr = r * BRIGHTNESS;
  let cg = g * BRIGHTNESS;
  let cb = b * BRIGHTNESS;

  // contrast(): slope about mid-grey. The intercept is in 0-255 because these channels are.
  const intercept = (0.5 - 0.5 * CONTRAST) * 255;
  cr = cr * CONTRAST + intercept;
  cg = cg * CONTRAST + intercept;
  cb = cb * CONTRAST + intercept;

  // saturate(): the Rec. 709 colour matrix, written as a lerp away from luma, which is the same
  // thing and does not need the matrix spelled out.
  if (Math.abs(SATURATION - 1) >= EPSILON) {
    const luma = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb;
    cr = luma + (cr - luma) * SATURATION;
    cg = luma + (cg - luma) * SATURATION;
    cb = luma + (cb - luma) * SATURATION;
  }

  return [clamp255(cr), clamp255(cg), clamp255(cb)];
}

/** A canvas context this can grade. Narrowed so Node's `@napi-rs/canvas` satisfies it too. */
export interface GradeTarget {
  getImageData(x: number, y: number, width: number, height: number): ImageData;
  putImageData(data: ImageData, x: number, y: number): void;
}

/**
 * Grades a rectangle of an already-composited canvas, in place.
 *
 * Arithmetic rather than `context.filter`, for the reason `export-plan.ts` gives: `filter` is not
 * supported everywhere and **fails silently** where it is not, which would make the sheets and the
 * export quietly disagree with each other between environments.
 *
 * Alpha is untouched. A no-op grade returns without reading the pixels at all, so wiring this in
 * before the constants are tuned costs nothing.
 */
export function applyGrade(
  context: GradeTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (isIdentity() || width <= 0 || height <= 0) return;

  const image = context.getImageData(x, y, width, height);
  const { data } = image;

  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b] = gradePixel(data[index]!, data[index + 1]!, data[index + 2]!);
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }

  context.putImageData(image, x, y);
}
