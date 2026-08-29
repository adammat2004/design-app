/**
 * One light for the whole plan.
 *
 * A drawing reads as a render rather than a diagram largely because everything in it agrees about
 * where the sun is. Slabs, and later decking boards, planting canopies and the sides of a pergola,
 * all shade to the vector below. It is exported rather than inlined precisely so the next pass has
 * something to import instead of picking its own.
 *
 * Top-left, matching the drop shadows already used on the canvas (`canvas-colours.ts` shadows fall
 * down-right, which is the same sun). In this frame +y is downwards, so a negative y points up the
 * screen.
 */
export const LIGHT_DIRECTION = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } as const;

/** How much lighter the two lit edges of a module are, as a fraction of the tone's brightness. */
export const MODULE_HIGHLIGHT = 0.07;

/** How much darker the two unlit edges are. Deeper than the highlight — shadows read stronger. */
export const MODULE_SHADOW = 0.1;

/**
 * Width of a module's shaded edge, as a fraction of its shorter side.
 *
 * A proportion rather than a real millimetre bevel, and the first attempt got this wrong: a slab's
 * true arris is 10-15 mm, which at any zoom the plan supports is under a pixel, so the shading was
 * computed and drawn and did nothing at all. This is a drawing convention — the same kind of thing
 * as the drop shadows already on the canvas — not a measurement, and the honest way to write a
 * convention is in units of the thing it decorates. Being proportional also means it never becomes
 * a fat border relative to the slab as the user zooms in.
 */
export const MODULE_BEVEL_RATIO = 0.035;

/**
 * Below this many pixels per module, shading is skipped entirely.
 *
 * At three or four pixels a slab, a highlight and a shadow are a pixel each and read as noise —
 * they make the paving look dithered rather than lit. The flat tone alone is more honest.
 */
export const MIN_SHADED_MODULE_PX = 12;

/* ---------------------------------------------------------------- colour maths */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` or `#rrggbb` to channels. Throws on anything else — a bad palette entry is a bug. */
export function hexToRgb(hex: string): Rgb {
  const body = hex.replace('#', '');

  const expanded =
    body.length === 3
      ? body
          .split('')
          .map((character) => character + character)
          .join('')
      : body;

  if (expanded.length !== 6 || Number.isNaN(Number.parseInt(expanded, 16))) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  const value = Number.parseInt(expanded, 16);

  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToCss({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Scales every channel by `1 + amount`, clamped.
 *
 * Multiplicative rather than additive so a dark tone and a light one shade by the same *visual*
 * proportion; adding a flat 12 to each channel would blow out the pale stones and barely touch
 * the dark ones.
 */
export function shiftBrightness(colour: Rgb, amount: number): Rgb {
  const scale = 1 + amount;
  const clamp = (channel: number) => Math.max(0, Math.min(255, channel * scale));

  return { r: clamp(colour.r), g: clamp(colour.g), b: clamp(colour.b) };
}
