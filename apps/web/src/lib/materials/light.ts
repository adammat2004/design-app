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

/* ---------------------------------------------------------------- contact shadows */

/**
 * The soft disc a sprite stands on, in units of the sprite.
 *
 * A drawing convention, in the same class as the module bevel: it is written in proportions of the
 * thing it decorates, it never reads the site, and it never scales with height. Its one tie to
 * the world is direction — it is pushed away from `DrawPass.light`, so under a real sun it agrees
 * with the cast shadows and under the conventional light it agrees with the bevels. What it must
 * never become is a claim about where the shade is at a time of day; that layer stays gated on a
 * location the user has actually stated.
 */
export const CONTACT_SHADOW_OFFSET_RATIO = 0.12;
export const CONTACT_SHADOW_SCALE = 1.15;
export const CONTACT_SHADOW_ALPHA = 0.28;

/** The strip of shade along the fence panels the sun is behind. Same class of convention. */
export const FENCE_SHADE_OPACITY = 0.14;

/* ---------------------------------------------------------------- cast shadows */

/**
 * The colour a cast shadow is drawn in, at **full opacity**.
 *
 * Opaque on purpose, and the reason is the whole trick behind the shadow layer. Two overlapping
 * shadows are one shadow — a tree standing in a hedge's shade does not make that patch twice as
 * dark — but drawing translucent shapes one after another does exactly that. Filling every piece
 * opaque into a layer of its own and compositing that layer once at `SHADOW_OPACITY` makes the
 * overlap merge for free, with no polygon-union library anywhere.
 *
 * A blue-grey rather than a neutral one. Shadowed ground outdoors is lit by the sky rather than
 * by the sun, and sky light is blue; a grey shadow reads as dirt on the drawing.
 */
export const SHADOW_TONE = '#4a5a63';

/**
 * How dark the composited shadow layer sits over the plan.
 *
 * Low enough that the material underneath still reads — the point of a shadow here is to say
 * "this corner is shaded", not to hide what is in it. A plan where you cannot tell paving from
 * planting in the shade has traded information for atmosphere.
 *
 * Raised from 0.26 when the lawn became a photograph: a blue-grey at a quarter opacity over pale
 * procedural turf was plain, and over real mid-green grass it all but vanished.
 */
export const SHADOW_OPACITY = 0.36;

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

/**
 * A CSS colour the canvas already paints — hex, `rgb()`, or `rgba()` — to channels.
 *
 * `hexToRgb` stays strict: a palette entry that is not a hex is a typo. `materialFill` is the
 * other kind of colour, a fill a canvas can use as-is, and a kept existing feature's is the
 * translucent keep-status green rather than a hex. Shading a roof from that fill has to read
 * the channels without claiming the string was a palette hex.
 *
 * Alpha is dropped. A roof overlay has its own opacity; folding 0.18 into the channels would
 * shade from nearly black.
 */
export function cssToRgb(colour: string): Rgb {
  if (colour.startsWith('#')) return hexToRgb(colour);

  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(colour);
  if (!match) throw new Error(`Not a colour: ${colour}`);

  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
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
