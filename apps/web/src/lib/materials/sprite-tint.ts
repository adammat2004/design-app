import type { LoadedAsset } from './assets/registry';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

/**
 * Plant sprites, tinted towards their material's own palette.
 *
 * ## Why this exists
 *
 * `MATERIAL_TONES` was written as the control over how each planting reads, and for the blob
 * renderer it is. But once the sprites arrived, `drawSprite` blitted the photograph **untinted** —
 * so for the five materials that actually have plant sprites the palette stopped reaching the
 * pixels at all, and the only things still separating a hedge from ground cover were unit size and
 * density. That is why every bed in the plan converges on one mid-green carpet whatever it is made
 * of: the photographs of a shrub, a perennial and a ground-cover plant are, from directly above and
 * at plan scale, very nearly the same green.
 *
 * Retuning the hexes could not have fixed it. This is what makes retuning them work.
 *
 * ## The rules
 *
 * - **A variant is tinted towards one palette entry, by index.** Not towards the average, which
 *   would flatten a bed to a single hue and throw away the variation the palette exists to give.
 *   Variant i takes `palette[i % palette.length]`, so a four-variant family across a four-tone
 *   palette gives four distinguishable plants.
 * - **`source-atop` against the sprite's own alpha**, so a soft leaf edge is tinted in proportion
 *   to how opaque it is and the cut-out never gains a halo.
 * - **Cached per (asset, variant, tone, strength)** and never per unit. A bed draws thousands of
 *   sprites from a handful of images; tinting in the inner loop would allocate a canvas per plant.
 * - **Absent `makeCanvas` returns the sprite untouched.** The same discipline as a missing asset
 *   file: the picture is plainer, never broken.
 */

/**
 * How far a sprite is carried towards its tone.
 *
 * Lower than the paving faces' `FACE_TINT`. A slab's photograph is a texture and can take a firm
 * wash; a plant's photograph is the *thing*, and pushing it too far turns a bed into flat cut-out
 * shapes — losing exactly the depth the sprites were introduced for. Enough to place a hedge below
 * a ground cover on the value ladder, not enough to make either stop looking like a photograph.
 */
export const SPRITE_TINT = 0.1;

const cache = new Map<string, PatternCanvas>();

/** The tone this variant is carried towards. Index-based, so a family spreads across the palette. */
export function toneForVariant(palette: readonly string[], index: number): string {
  return palette[index % palette.length]!;
}

/**
 * A tinted copy of one sprite, drawn once and kept.
 *
 * Returns the original when there is nothing to do — no canvas factory, no palette, or a strength
 * of zero — so the untinted path stays reachable and byte-identical.
 */
export function tintSprite(
  asset: LoadedAsset,
  tone: string,
  strength: number,
  makeCanvas: MakeCanvas | undefined,
): LoadedAsset {
  if (!makeCanvas || strength <= 0) return asset;

  const key = `${asset.entry.id}:${asset.entry.variant}:${tone}:${strength}`;
  const held = cache.get(key);
  if (held) return { ...asset, image: held };

  const { width, height } = asset.image;
  if (width <= 0 || height <= 0) return asset;

  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return asset;

  context.drawImage(asset.image as PatternCanvas, 0, 0, width, height);

  /*
   * Only where the sprite already is. `source-atop` keeps the destination's alpha, so the wash
   * lands on the plant and not on the transparent margin round it — which is what stops a tinted
   * cut-out gaining a visible square edge.
   */
  context.globalCompositeOperation = 'source-atop';
  context.globalAlpha = strength;
  context.fillStyle = tone;
  context.fillRect(0, 0, width, height);

  cache.set(key, canvas);

  return { ...asset, image: canvas };
}

/**
 * A tinted copy of one *texture* tile, drawn once and kept.
 *
 * Separate from `tintSprite` for one reason that matters: it composites `multiply` over the whole
 * tile rather than `source-atop`, and it is baked into the tile instead of being washed over the
 * finished surface.
 *
 * ## Why baking it in is the whole point
 *
 * The wash used to be applied per *surface*, after tiling — a `multiply` fill across the outline.
 * That is not idempotent, and surfaces genuinely do stack: `computeZones` gives a garden one base
 * lawn per zone and an accent lawn is drawn on top of one of them, so a measured 25% of the
 * suburban fixture's lawn was covered twice and took the tint twice. The result was rectangular
 * blocks of darker green with hard edges down the middle of one continuous lawn — the exact
 * "obviously tiled grass" the material work exists to remove, and a direct contradiction of the
 * rule that a lawn is one ground the zones merely cut up.
 *
 * Tinted into the tile, the tile is opaque, so drawing it twice writes the same pixels twice.
 * Overlap becomes invisible, which is what it always should have been.
 */
export function tintTexture(
  asset: LoadedAsset,
  tone: string,
  strength: number,
  makeCanvas: MakeCanvas | undefined,
): LoadedAsset {
  if (!makeCanvas || strength <= 0) return asset;

  const key = `tex:${asset.entry.id}:${asset.entry.variant}:${tone}:${strength}`;
  const held = cache.get(key);
  if (held) return { ...asset, image: held };

  const { width, height } = asset.image;
  if (width <= 0 || height <= 0) return asset;

  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return asset;

  context.drawImage(asset.image as PatternCanvas, 0, 0, width, height);

  /*
   * Multiplied rather than washed, for the reason `FACE_TINT` gives: proportional, so a pale
   * gravel keeps its brightness while a dark slate is carried where its palette says.
   */
  context.globalCompositeOperation = 'multiply';
  context.globalAlpha = strength;
  context.fillStyle = tone;
  context.fillRect(0, 0, width, height);

  cache.set(key, canvas);

  return { ...asset, image: canvas };
}

/** Tints a family's variants across a palette, in order. */
export function tintSprites(
  assets: LoadedAsset[],
  palette: readonly string[],
  makeCanvas: MakeCanvas | undefined,
  strength = SPRITE_TINT,
): LoadedAsset[] {
  if (!makeCanvas || palette.length === 0) return assets;

  return assets.map((asset, index) =>
    tintSprite(asset, toneForVariant(palette, index), strength, makeCanvas),
  );
}

/* ---------------------------------------------------------------- test seams */

export function clearSpriteTintCache(): void {
  cache.clear();
}

export function spriteTintCacheSize(): number {
  return cache.size;
}
