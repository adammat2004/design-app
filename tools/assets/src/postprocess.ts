import sharp from 'sharp';

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
  /** Elevated sprites: where the opaque pixels are, as fractions of the image. */
  opaqueBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Elevated sprites: how much of the bottom edge band is opaque, 0-1. The ground-plane detector. */
  footAlpha?: number;
  /** Anything the QA pass found wrong with the picture. Empty is a pass. */
  warnings?: string[];
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

async function raw(image: sharp.Sharp): Promise<Raw> {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function fromRaw(image: Raw): sharp.Sharp {
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

/* ---------------------------------------------------------------- elevated sprites */

/**
 * An elevated sprite: trimmed, **bottom-aligned** in its frame, and measured.
 *
 * The difference from `processSprite` is one line and it is the whole of the 2.5D placement model.
 * A plan sprite is centred, because a plan sprite *is* its footprint and the middle of the image is
 * the middle of the thing. An elevated one is its footprint with its height leaning up the screen,
 * so the object stands on the **bottom** edge of the frame and everything above the footprint band
 * is height. Centre it and every object floats half its own height off the ground it stands on.
 *
 * `fit: 'contain'` with `position: 'bottom'` does exactly that: scale to fit, then pad the
 * *remaining* space above rather than splitting it. The model is asked for the same framing, so on
 * a well-generated asset there is almost nothing to pad — this is the guarantee, not the mechanism.
 */
export async function processElevatedSprite(
  png: Buffer,
  sizePx: { w: number; h: number },
  footprintDepth: number,
  frameDepth: number,
): Promise<Processed> {
  /*
   * Clipping is measured on what the **model returned**, before anything is trimmed, and that is
   * the only place it can be measured at all.
   *
   * The first version checked the finished file and warned on every asset. Of course it did: a
   * contain-fit puts the content hard against the two edges of whichever axis limited it, so
   * "touches an edge" is true of every correctly framed sprite by construction. What is actually
   * worth knowing is whether the *model* ran the object off its own canvas, and after a trim that
   * evidence is gone.
   */
  const original = await raw(sharp(png).ensureAlpha());
  const clipped = touchesBorder(original);

  const trimmed = await sharp(png).ensureAlpha().trim({ threshold: 12 }).toBuffer();

  const fitted = await sharp(trimmed)
    .resize(sizePx.w, sizePx.h, {
      fit: 'contain',
      position: 'bottom',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .toBuffer();

  const image = await raw(sharp(fitted));
  /*
   * Lossy with alpha rather than the lossless a plan sprite gets. The plan library is already 25 MB
   * across 99 files and this one is more detailed; at quality 90 the difference is invisible at
   * every zoom the plan supports and the payload is roughly a fifth. Alpha is kept exact by
   * `alphaQuality: 100`, which matters more than the colour: a soft alpha edge is what stops a
   * sprite showing a fringe against the lawn.
   */
  const webp = await fromRaw(image).webp({ quality: 90, alphaQuality: 100 }).toBuffer();

  const bounds = opaqueBounds(image);
  const foot = footAlpha(image);

  return {
    webp,
    widthPx: image.width,
    heightPx: image.height,
    meanColour: meanColour(image),
    opaqueBounds: bounds,
    footAlpha: foot,
    warnings: elevatedWarnings(image, bounds, foot, footprintDepth, frameDepth, clipped),
  };
}

/** Whether any opaque pixel sits on the image's own border: the model cropped the object. */
function touchesBorder(image: Raw): boolean {
  const opaque = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]! >= 64;

  for (let x = 0; x < image.width; x += 1) {
    if (opaque(x, 0) || opaque(x, image.height - 1)) return true;
  }
  for (let y = 0; y < image.height; y += 1) {
    if (opaque(0, y) || opaque(image.width - 1, y)) return true;
  }
  return false;
}

/** Where the opaque pixels are, as fractions of the image. `null`-ish empty box when there are none. */
export function opaqueBounds(image: Raw): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! < 64) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    minX: round(minX / image.width),
    minY: round(minY / image.height),
    maxX: round((maxX + 1) / image.width),
    maxY: round((maxY + 1) / image.height),
  };
}

/** How much of a horizontal band across the image is opaque, 0-1. */
function bandCoverage(image: Raw, from: number, to: number): number {
  const first = Math.max(0, Math.min(image.height - 1, Math.round(image.height * from)));
  const last = Math.max(first + 1, Math.min(image.height, Math.round(image.height * to)));

  let opaque = 0;
  let total = 0;
  for (let y = first; y < last; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! >= 64) opaque += 1;
      total += 1;
    }
  }
  return total === 0 ? 0 : opaque / total;
}

/** How much of the bottom 2% of the frame is opaque. Recorded for the audit; see `spreadsAtTheFoot`. */
export function footAlpha(image: Raw): number {
  return Math.round(bandCoverage(image, 0.98, 1) * 1000) / 1000;
}

/**
 * Whether the object gets **wider** where it meets the ground than it is through its body.
 *
 * This is the ground-plane detector, and it is the second attempt. The first compared the bottom
 * band against a fixed threshold, on the reasoning that an object's own feet are a few percent of
 * the frame and a baked patch of grass is most of it. That is true of a sofa and false of a great
 * many things: a planter is a box, a raised bed is a box, a trampoline is a disc — each of them
 * fills its own frame at the bottom because its footprint *is* its frame, and each was flagged.
 *
 * What actually distinguishes a ground plane is not how wide it is but that it **spreads**: a patch
 * of grass or a soft ellipse reaches out past the object standing on it, where legs, a pot's base
 * and a trampoline's rim never reach past the body above them. Comparing the two bands asks that
 * question directly and is blind to how wide the object happens to be.
 */
function spreadsAtTheFoot(image: Raw): boolean {
  const foot = bandCoverage(image, 0.96, 1);
  const body = bandCoverage(image, 0.45, 0.65);
  return foot > 0.5 && foot > body * 1.2 + 0.05;
}

/**
 * What the QA pass can check without looking at the picture.
 *
 * Deliberately a list of warnings rather than a throw. Some of these are judgements a number gets
 * *mostly* right — a very wide low planter legitimately has a broad foot — and a tool that refused
 * them outright would have the author editing thresholds instead of looking at assets. `--strict`
 * is what turns them into a refusal, for a batch run where nobody is watching.
 *
 * Everything a number cannot answer — is the camera angle right, is the light on the correct side,
 * are the proportions believable — is on the contact sheet instead. See `docs/visualise-asset-style.md`.
 */
function elevatedWarnings(
  image: Raw,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  foot: number,
  footprintDepth: number,
  frameDepth: number,
  clipped: boolean,
): string[] {
  const warnings: string[] = [];

  const corners = [
    0,
    (image.width - 1) * 4,
    (image.height - 1) * image.width * 4,
    ((image.height - 1) * image.width + image.width - 1) * 4,
  ];
  if (corners.some((index) => image.data[index + 3]! >= 64)) {
    warnings.push('a corner is opaque — the background is not transparent');
  }

  const footprintShare = frameDepth > 0 ? footprintDepth / frameDepth : 1;

  if (spreadsAtTheFoot(image)) {
    warnings.push(
      `spreads at the foot (${(foot * 100).toFixed(0)}% of the bottom edge) — a ground plane or a baked shadow`,
    );
  }

  /*
   * A contain fit makes the limiting axis fill the frame exactly, so "does it fill the width" is
   * the wrong question — it is only ever true of whichever axis limited. What is worth knowing is
   * whether the *other* axis is badly short, which means the model's proportions disagree with the
   * metres the family declares and the object will be drawn smaller than its footprint.
   */
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (Math.max(width, height) < 0.95) {
    warnings.push('fills neither axis of its frame — it was trimmed to nothing sensible');
  }
  if (Math.min(width, height) < 0.55) {
    warnings.push(
      `only ${(Math.min(width, height) * 100).toFixed(0)}% of one axis — the model's proportions ` +
        'disagree with the size this family declares',
    );
  }
  if (clipped) {
    warnings.push('the model ran the object off its own canvas — it is cropped');
  }
  // The object has to reach down into its own footprint band, or it is drawn hovering.
  if (bounds.maxY < 1 - footprintShare) {
    warnings.push('does not reach its footprint band — the object will float above the ground');
  }

  const fringe = edgeFringe(image);
  if (fringe > 0.22) {
    warnings.push(`soft edge is ${(fringe * 100).toFixed(0)}% off the interior colour — a halo`);
  }

  return warnings;
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

export async function processTexture(
  png: Buffer,
  sizePx: { w: number; h: number },
): Promise<Processed> {
  const resized = await raw(
    sharp(png).resize(sizePx.w, sizePx.h, { fit: 'cover', kernel: 'lanczos3' }),
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
