import {
  geometryAnchor,
  resolveSymbol,
  type DesignElement,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import { SYMBOL_SPRITES } from '../assets/material-assets';
import type { AssetLookup, LoadedAsset } from '../assets/registry';
import { moduleRandom } from '../prng';

/**
 * How a sprite sits inside the geometry of record.
 *
 * The element's rect or radius is what the validator checked and the placer reserved; the sprite
 * is fitted inside it, `contain`-style, and never past it. A rect sprite is drawn in the rect's
 * own rotated frame, so its long side follows the rect's long side; a point sprite spans the
 * diameter.
 */
export interface SpriteBox {
  centre: Point;
  /** Metres, in the sprite's own frame — before `rotation` is applied. */
  width: number;
  height: number;
  /** Degrees clockwise. */
  rotation: number;
}

export function spriteBox(
  shape: PlanGeometry,
  image: { width: number; height: number },
): SpriteBox | null {
  const aspect = image.width / image.height;

  if (shape.kind === 'point') {
    const diameter = shape.radius * 2;
    return aspect >= 1
      ? { centre: shape.at, width: diameter, height: diameter / aspect, rotation: 0 }
      : { centre: shape.at, width: diameter * aspect, height: diameter, rotation: 0 };
  }

  if (shape.kind !== 'rect') return null;

  /*
   * Fit the sprite's aspect inside the rect, turning it a quarter if the rect runs the other way:
   * a lounger is drawn long, and a placer that reserved a wide rect for it still gets a lounger
   * lying across, not a squashed one.
   */
  const rectAspect = shape.width / shape.depth;
  const turn = aspect >= 1 !== rectAspect >= 1;
  const target = turn
    ? { w: shape.depth, d: shape.width, rotation: shape.rotation + 90 }
    : { w: shape.width, d: shape.depth, rotation: shape.rotation };

  const byWidth = { width: target.w, height: target.w / aspect };
  const fitted =
    byWidth.height <= target.d ? byWidth : { width: target.d * aspect, height: target.d };

  return { centre: shape.centre, ...fitted, rotation: target.rotation };
}

/**
 * The sprite an element's symbol is drawn with, and where, or `null` when it has no symbol, the
 * symbol is one that is drawn rather than photographed, or the family has not loaded.
 *
 * The variant is chosen by the same seeded generator the canopies use, from the element's id and
 * anchor, so a bench keeps its look across every redraw and the two canvases agree on it.
 */
export function symbolSprite(
  element: DesignElement,
  lookup: AssetLookup | undefined,
): { asset: LoadedAsset; box: SpriteBox } | null {
  const symbol = resolveSymbol(element);
  if (!symbol || !lookup) return null;

  const family = SYMBOL_SPRITES[symbol];
  if (!family) return null;

  const variants = lookup(family);
  if (variants.length === 0) return null;

  const anchor = geometryAnchor(element.shape);
  const random = moduleRandom(element.id, Math.round(anchor.x * 100), Math.round(anchor.y * 100));
  const asset = variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))]!;

  const box = spriteBox(element.shape, asset.image);
  return box ? { asset, box } : null;
}
