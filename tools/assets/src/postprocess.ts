import sharp, { type Sharp } from 'sharp';

/**
 * From a model's PNG to the file the app ships, plus the numbers the catalogue records.
 *
 * Three treatments, one per asset kind:
 *
 * - A **sprite** is trimmed to its alpha, padded back to its aspect and downsampled. The catalogue
 *   records how far its opaque pixels reach from the centre, as a fraction of the half-width, so a
 *   tree canopy can be scaled to sit *inside* the radius the geometry uses — the placer erodes by
 *   exactly that radius and the validator tessellates the same circle, so a lobe hanging past it
 *   is the drawing disagreeing with the model.
 * - A **texture** is downsampled and then made to tile. A model does not promise a seamless
 *   result, so the seam is measured (mean difference between the two edges that will meet) and,
 *   when it would show, hidden by the offset-and-blend trick: the tile is rolled half a period so
 *   its old edges meet in the middle, and the original is faded back in over the centre. Never
 *   mirror-tiled — a mirrored gravel is a Rorschach blot.
 * - A **face** is one module's surface: cropped to cover the target aspect and downsampled.
 */

/**
 * Which post-processing produced a file. Bump when a measurement or a treatment changes, so the
 * catalogue can say which files were measured the old way and `--reprocess` knows what to redo.
 */
export const POSTPROCESS_VERSION = '2';

export interface Processed {
  webp: Buffer;
  widthPx: number;
  heightPx: number;
  /** Mean of the opaque pixels, as `#rrggbb`. What the `mass` tier can cross-check against. */
  meanColour: string;
  /** Sprites: furthest opaque pixel from the centre ÷ half the shorter side. */
  opaqueRadiusRatio?: number;
  /** Textures: edge mismatch after treatment, 0 (perfect) to 1. */
  seamScore?: number;
  /**
   * What the QA pass found, in two lists that mean different things.
   *
   * A **defect** is a picture the renderer cannot use as it is: an opaque background. `--strict`
   * refuses these. A **warning** is a judgement a number gets *mostly* right — how much of a halo is
   * acceptable depends on where the sprite lands — and is recorded beside the file for a person to
   * look at, never refused.
   * One flat list was the first design, and it left `--strict` with the choice between refusing
   * every judgement and refusing nothing.
   */
  warnings?: string[];
  defects?: string[];
  /** A correction baked into the file at source, so the renderer need not apply it at draw time. */
  correction?: { saturation: number };
}

/**
 * The two checks every sprite gets.
 *
 * Transparency is the one thing the model is most likely to get wrong and the one the renderer can
 * least tolerate — an opaque plan sprite is a white square on the lawn — so a corner that is opaque
 * is a defect. A coloured fringe is a warning: it shows against dark ground and hides against pale,
 * and how much of it is acceptable depends on where the sprite lands.
 */
function spriteChecks(image: Raw): { warnings: string[]; defects: string[] } {
  const warnings: string[] = [];
  const defects: string[] = [];

  const corners = [
    0,
    (image.width - 1) * 4,
    (image.height - 1) * image.width * 4,
    ((image.height - 1) * image.width + image.width - 1) * 4,
  ];
  if (corners.some((index) => image.data[index + 3]! >= 64)) {
    defects.push('a corner is opaque — the background is not transparent');
  }

  const fringe = edgeFringe(image);
  if (fringe > 0.22) {
    warnings.push(`soft edge is ${(fringe * 100).toFixed(0)}% off the interior colour — a halo`);
  }

  return { warnings, defects };
}

/**
 * Above this the seam shows at plan scale and the tile is blended.
 *
 * The score is a *ratio*: how different the two wrapping edges are, over how different two
 * neighbouring columns are anywhere inside the tile. A seamless tile scores about 1 whatever its
 * grain — fine grass differs a lot pixel to pixel everywhere, and an absolute measure would call
 * every lawn a bad seam while passing a smooth pool with a real one.
 */
export const SEAM_THRESHOLD = 1.5;

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function raw(image: Sharp): Promise<Raw> {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function fromRaw(image: Raw): Sharp {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
}

/* ---------------------------------------------------------------- sprites */

export async function processSprite(
  png: Buffer,
  sizePx: { w: number; h: number },
): Promise<Processed> {
  const trimmed = await sharp(png).ensureAlpha().trim({ threshold: 12 }).toBuffer();

  const fitted = await sharp(trimmed)
    .resize(sizePx.w, sizePx.h, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .toBuffer();

  const image = await raw(sharp(fitted));
  const webp = await fromRaw(image).webp({ lossless: true }).toBuffer();

  return {
    webp,
    widthPx: image.width,
    heightPx: image.height,
    meanColour: meanColour(image),
    opaqueRadiusRatio: opaqueRadiusRatio(image),
    ...spriteChecks(image),
  };
}

/**
 * How far the opaque pixels reach from the centre, ÷ half the shorter side.
 *
 * A canopy generated to fill its frame comes back at very nearly 1; one that stops short leaves
 * headroom the renderer can use. It is never allowed to be the thing that decides the geometry.
 */
function opaqueRadiusRatio(image: Raw): number {
  const cx = image.width / 2;
  const cy = image.height / 2;
  const half = Math.min(image.width, image.height) / 2;
  let furthest = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]!;
      if (alpha < 64) continue;
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (distance > furthest) furthest = distance;
    }
  }

  return Math.round((furthest / half) * 1000) / 1000;
}

/**
 * How far the half-transparent edge pixels sit from the colour of the solid interior.
 *
 * A clean cut-out fades an object's own colour to nothing. A matte-line halo fades it to whatever
 * the model's background was — usually white — and that difference survives every tint and shows
 * against every dark surface. Measured as a mean channel distance, normalised.
 */
export function edgeFringe(image: Raw): number {
  const { data } = image;
  let edgeR = 0;
  let edgeG = 0;
  let edgeB = 0;
  let edgeN = 0;
  let inR = 0;
  let inG = 0;
  let inB = 0;
  let inN = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha >= 10 && alpha <= 60) {
      edgeR += data[i]!;
      edgeG += data[i + 1]!;
      edgeB += data[i + 2]!;
      edgeN += 1;
    } else if (alpha >= 250) {
      inR += data[i]!;
      inG += data[i + 1]!;
      inB += data[i + 2]!;
      inN += 1;
    }
  }

  if (edgeN === 0 || inN === 0) return 0;

  const distance =
    (Math.abs(edgeR / edgeN - inR / inN) +
      Math.abs(edgeG / edgeN - inG / inN) +
      Math.abs(edgeB / edgeN - inB / inN)) /
    3;

  return Math.round((distance / 255) * 1000) / 1000;
}

/* ---------------------------------------------------------------- textures */

/**
 * A texture, with any correction the family asks for **baked into the file**.
 *
 * A saturation correction lives here rather than at draw time for the reason `tintTexture` bakes
 * the palette into the tile: two surfaces of one material overlap by design, and anything applied
 * per draw over an overlap is applied twice. Baking it once also corrects the 2D Plan, the concept
 * cards and the export equally, which a draw-time grade cannot. What was applied is recorded on
 * the result so the catalogue can say so and `--reprocess` reproduces it from the raw.
 */
export async function processTexture(
  png: Buffer,
  sizePx: { w: number; h: number },
  correction?: { saturation?: number },
): Promise<Processed> {
  const saturation = correction?.saturation;
  const corrected = saturation !== undefined && saturation !== 1 ? { saturation } : undefined;

  let source = sharp(png);
  if (corrected) source = source.modulate({ saturation: corrected.saturation });

  const resized = await raw(
    source.resize(sizePx.w, sizePx.h, { fit: 'cover', kernel: 'lanczos3' }),
  );

  let image = resized;
  let seam = seamScore(image);

  if (seam > SEAM_THRESHOLD) {
    image = makeSeamless(image);
    seam = seamScore(image);
  }

  const webp = await fromRaw(image).webp({ quality: 88 }).toBuffer();

  return {
    webp,
    widthPx: image.width,
    heightPx: image.height,
    meanColour: meanColour(image),
    seamScore: seam,
    ...(corrected ? { correction: corrected } : {}),
  };
}

/**
 * How much worse the wrapping edges match than any two neighbouring columns and rows inside the
 * tile do. About 1 for a seamless tile; see `SEAM_THRESHOLD`.
 */
export function seamScore(image: Raw): number {
  const { data, width, height } = image;

  const diff = (a: number, b: number): number => {
    let total = 0;
    for (let c = 0; c < 3; c += 1) total += Math.abs(data[a + c]! - data[b + c]!);
    return total;
  };

  let seam = 0;
  let seamCount = 0;
  for (let y = 0; y < height; y += 1) {
    seam += diff(y * width * 4, (y * width + width - 1) * 4);
    seamCount += 1;
  }
  for (let x = 0; x < width; x += 1) {
    seam += diff(x * 4, ((height - 1) * width + x) * 4);
    seamCount += 1;
  }

  // The tile's own grain: neighbouring columns and rows sampled through the middle.
  let interior = 0;
  let interiorCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (const x of [Math.floor(width * 0.25), Math.floor(width * 0.5), Math.floor(width * 0.75)]) {
      interior += diff((y * width + x) * 4, (y * width + x + 1) * 4);
      interiorCount += 1;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (const y of [
      Math.floor(height * 0.25),
      Math.floor(height * 0.5),
      Math.floor(height * 0.75),
    ]) {
      interior += diff((y * width + x) * 4, ((y + 1) * width + x) * 4);
      interiorCount += 1;
    }
  }

  const seamMean = seam / seamCount;
  const interiorMean = Math.max(interior / interiorCount, 1);
  return Math.round((seamMean / interiorMean) * 1000) / 1000;
}

/**
 * Offset by half a period and fade the original back in over the middle.
 *
 * Rolling puts the tile's four edges together in the centre — where they now form a visible cross
 * — and its former centre at the new edges, which therefore match perfectly. Blending the
 * original back in with a mask that is 1 in the middle and 0 at the edges hides the cross while
 * leaving the edges as they are. Two seams traded for none, at the cost of some repetition in the
 * blend band, which at plan scale nobody can see.
 */
export function makeSeamless(image: Raw): Raw {
  const { width, height, data } = image;
  const out = Buffer.alloc(data.length);
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  /** How far in from an edge the fade reaches, in pixels. */
  const band = Math.min(width, height) * 0.3;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rolledX = (x + halfW) % width;
      const rolledY = (y + halfH) % height;

      const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
      const t = Math.min(1, edge / band);
      // Smoothstep, so the blend has no visible start line.
      const mix = t * t * (3 - 2 * t);

      const a = (y * width + x) * 4;
      const b = (rolledY * width + rolledX) * 4;

      for (let c = 0; c < 4; c += 1) {
        out[a + c] = Math.round(data[b + c]! * (1 - mix) + data[a + c]! * mix);
      }
    }
  }

  return { data: out, width, height };
}

/* ---------------------------------------------------------------- faces */

export async function processFace(
  png: Buffer,
  sizePx: { w: number; h: number },
): Promise<Processed> {
  const image = await raw(
    sharp(png).resize(sizePx.w, sizePx.h, { fit: 'cover', kernel: 'lanczos3' }),
  );
  const webp = await fromRaw(image).webp({ quality: 88 }).toBuffer();

  return { webp, widthPx: image.width, heightPx: image.height, meanColour: meanColour(image) };
}

/* ---------------------------------------------------------------- drawn here */

/** A radial falloff disc: the contact shadow every sprite stands on. */
export async function softShadowDisc(sizePx: { w: number; h: number }): Promise<Processed> {
  const { w: width, h: height } = sizePx;
  const data = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      // Opaque to about 40% out, then a smooth fall to nothing at the rim.
      const t = Math.max(0, Math.min(1, (d - 0.4) / 0.6));
      const alpha = 1 - t * t * (3 - 2 * t);
      const i = (y * width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const image = { data, width, height };
  const webp = await fromRaw(image).webp({ lossless: true }).toBuffer();

  return {
    webp,
    widthPx: width,
    heightPx: height,
    meanColour: '#000000',
    opaqueRadiusRatio: opaqueRadiusRatio(image),
  };
}

/**
 * The pool of light a fitting throws, as arithmetic.
 *
 * A different curve from `softShadowDisc`, and deliberately so. A contact shadow has an edge — the
 * object sits on the ground and the shadow stops — so it is opaque to 40% out and then falls. A
 * beam has no edge at all: it is brightest at the middle and never quite reaches nothing, which is
 * why this is an inverse-square-ish falloff over the whole radius rather than a plateau and a ramp.
 * Drawn with a hard rim instead, a light pool reads as a painted circle on the lawn.
 *
 * Warm white, because 2700 K is what garden lighting is. The colour is baked into the pixels
 * rather than tinted at draw time for the reason `tintTexture` exists: the pools of two fittings
 * overlap constantly, and anything applied per-draw over an overlap is applied twice.
 */
export async function lightPoolDisc(sizePx: { w: number; h: number }): Promise<Processed> {
  const { w: width, h: height } = sizePx;
  const data = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius);
      // Bright core, long tail, and exactly zero at the rim so tiles of it never show an edge.
      const falloff = (1 - d) * (1 - d) * (1 - d * 0.5);
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 236;
      data[i + 2] = 198;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, falloff)) * 255);
    }
  }

  const image = { data, width, height };
  const webp = await fromRaw(image).webp({ lossless: true }).toBuffer();

  return {
    webp,
    widthPx: width,
    heightPx: height,
    meanColour: '#ffecc6',
    opaqueRadiusRatio: opaqueRadiusRatio(image),
  };
}

/* ---------------------------------------------------------------- stats */

function meanColour(image: Raw): string {
  const { data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    n += 1;
  }

  if (n === 0) return '#000000';

  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
