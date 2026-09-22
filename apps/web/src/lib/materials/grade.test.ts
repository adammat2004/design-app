import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  applyGrade,
  BRIGHTNESS,
  CONTRAST,
  GRADE_FILTER_ID,
  WARMTH,
  gradeCss,
  warmthMatrix,
  gradePixel,
  SATURATION,
  type GradeTarget,
} from './grade';

/**
 * The grade exists twice — as a CSS `filter` on the Visualise wrapper and as pixel arithmetic for
 * the sheets, the export and the thumbnails — because no single canvas holds both of Visualise's
 * stacked layers, and no DOM exists on the drawn paths. Two implementations of one effect is
 * exactly the drift `buildRenderScene` was built to prevent, so they are held to each other here.
 *
 * The reference implementation is the CSS Filter Effects specification itself, written out below
 * independently of `grade.ts`. If someone "optimises" `gradePixel` into a single fused matrix and
 * gets the order or the intercept wrong, this fails; a test that called `gradePixel` twice would
 * not.
 */

/**
 * `brightness(b)` then `contrast(c)` then `saturate(s)`, per the spec, on non-linear sRGB — which
 * is what the CSS shorthand filter functions use, and the reason the arithmetic can match a browser
 * rather than merely resemble one.
 *
 * Deliberately spelled out longhand, including the saturation matrix's nine coefficients, rather
 * than reusing the lerp-toward-luma shortcut `grade.ts` takes. Two routes to the same number is the
 * only thing that makes agreement evidence.
 */
function specFilter(r: number, g: number, b: number): [number, number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(255, v));

  // brightness(): linear transfer.
  let cr = r * BRIGHTNESS;
  let cg = g * BRIGHTNESS;
  let cb = b * BRIGHTNESS;

  // contrast(): slope with an intercept that fixes mid-grey.
  const intercept = (0.5 - 0.5 * CONTRAST) * 255;
  cr = cr * CONTRAST + intercept;
  cg = cg * CONTRAST + intercept;
  cb = cb * CONTRAST + intercept;

  // saturate(): the specified 3x3, built from the Rec. 709 luminance coefficients.
  const s = SATURATION;
  const [lr, lg, lb] = [0.2126, 0.7152, 0.0722];
  const m = [
    lr + s * (1 - lr), lg * (1 - s), lb * (1 - s),
    lr * (1 - s), lg + s * (1 - lg), lb * (1 - s),
    lr * (1 - s), lg * (1 - s), lb + s * (1 - lb),
  ];

  const sr = m[0]! * cr + m[1]! * cg + m[2]! * cb;
  const sg = m[3]! * cr + m[4]! * cg + m[5]! * cb;
  const sb = m[6]! * cr + m[7]! * cg + m[8]! * cb;

  /*
   * And the `feColorMatrix` the filter list references last, driven from the *published* matrix
   * string rather than from `WARMTH` — so this replicates what the browser is actually handed
   * rather than what the module meant to hand it. A typo in `warmthMatrix()` is exactly the failure
   * this sweep exists to catch, and reading the constants directly would sail past it.
   *
   * Row-major, twenty values, RGBA plus offsets, over **sRGB** — see `GradeFilter` for why that
   * last word is load-bearing.
   */
  const w = warmthMatrix().split(' ').map(Number);
  return [
    clamp(w[0]! * sr + w[1]! * sg + w[2]! * sb + w[4]! * 255),
    clamp(w[5]! * sr + w[6]! * sg + w[7]! * sb + w[9]! * 255),
    clamp(w[10]! * sr + w[11]! * sg + w[12]! * sb + w[14]! * 255),
  ];
}

describe('the scene grade', () => {
  it('matches the CSS filter specification on every channel of a full sweep', () => {
    let worst = 0;

    for (let r = 0; r <= 255; r += 5) {
      for (let g = 0; g <= 255; g += 5) {
        for (let b = 0; b <= 255; b += 5) {
          const ours = gradePixel(r, g, b);
          const spec = specFilter(r, g, b);
          for (let channel = 0; channel < 3; channel += 1) {
            worst = Math.max(worst, Math.abs(ours[channel]! - spec[channel]!));
          }
        }
      }
    }

    // One channel step. Anything larger and the screen and the download are different pictures.
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('writes a CSS filter naming exactly the terms that are not identity', () => {
    const css = gradeCss();

    expect(css).toContain(`brightness(${BRIGHTNESS})`);
    expect(css).toContain(`contrast(${CONTRAST})`);
    expect(css).toContain(`saturate(${SATURATION})`);
    expect(css).toContain(`url(#${GRADE_FILTER_ID})`);

    // The order is load-bearing: these operations do not commute, and the arithmetic applies
    // brightness, then contrast, then saturation.
    expect(css.indexOf('brightness')).toBeLessThan(css.indexOf('contrast'));
    expect(css.indexOf('contrast')).toBeLessThan(css.indexOf('saturate'));
    expect(css.indexOf('saturate')).toBeLessThan(css.indexOf('url('));
  });

  /*
   * The warm term is the one part of the grade CSS cannot say in shorthand, so it travels as a
   * matrix — and a matrix that disagrees with `WARMTH` is a screen that disagrees with the
   * download, which is the fault this whole module exists to prevent.
   */
  it('publishes the warm term as a diagonal matrix carrying exactly those gains', () => {
    const values = warmthMatrix().split(' ').map(Number);

    expect(values).toHaveLength(20);
    expect(values[0]).toBeCloseTo(WARMTH.r, 6);
    expect(values[6]).toBeCloseTo(WARMTH.g, 6);
    expect(values[12]).toBeCloseTo(WARMTH.b, 6);
    expect(values[18]).toBe(1);

    // Everything off the diagonal: a per-channel gain mixes nothing and offsets nothing.
    const diagonal = new Set([0, 6, 12, 18]);
    values.forEach((value, index) => {
      if (!diagonal.has(index)) expect(value, `cell ${index}`).toBe(0);
    });
  });

  /*
   * The grade is a finishing pass over a finished composite, so it must never run twice on one
   * picture. This does not assert that grading twice equals grading once — it does not, and it must
   * not, or the constants would be doing nothing. It pins the weaker and actually useful property:
   * a second pass is detectable, so a double application cannot hide.
   */
  it('is not idempotent, which is why it may only be applied once', () => {
    const once = gradePixel(120, 140, 110);
    const twice = gradePixel(once[0], once[1], once[2]);

    expect(twice).not.toEqual(once);
  });

  it('leaves alpha alone and grades only the rectangle it is given', () => {
    const canvas = createCanvas(4, 2);
    const context = canvas.getContext('2d');

    const image = context.createImageData(4, 2);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 120;
      image.data[i + 1] = 140;
      image.data[i + 2] = 110;
      image.data[i + 3] = 200;
    }
    context.putImageData(image, 0, 0);

    // The left half only.
    applyGrade(context as unknown as GradeTarget, 0, 0, 2, 2);

    const after = context.getImageData(0, 0, 4, 2).data;
    const graded = gradePixel(120, 140, 110);

    /*
     * Within one step rather than exact: `ImageData` is a `Uint8ClampedArray`, which rounds halves
     * to even, where `Math.round` rounds them up. A value landing on x.5 therefore differs by one
     * between the two, and the canvas is the one that is actually right about what got stored.
     */
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(after[channel]! - graded[channel]!)).toBeLessThanOrEqual(1);
    }
    expect(after[3]).toBe(200);

    // The untouched half is still exactly what was written there.
    const rightIndex = 2 * 4;
    expect([after[rightIndex], after[rightIndex + 1], after[rightIndex + 2]]).toEqual([
      120, 140, 110,
    ]);
  });

  /*
   * The numbers are a measurement, not a preference, and this is the guard rail on retuning them.
   *
   * `SATURATION` is below 1 only to compensate for what `CONTRAST` does to measured saturation on
   * the way past — the raw like-for-like saturation gap is about 1%. So the two move together: a
   * `CONTRAST` of 1 with a `SATURATION` well under it would desaturate a render that was already
   * correct, which is precisely the mistake the original brief would have shipped.
   */
  it('keeps saturation compensation tied to contrast expansion', () => {
    if (Math.abs(CONTRAST - 1) < 1e-6) {
      expect(SATURATION).toBeCloseTo(1, 6);
    } else {
      expect(SATURATION).toBeLessThan(1);
      expect(CONTRAST).toBeGreaterThan(1);
    }
  });
});
