'use client';

import { Image as KonvaImage } from 'react-konva';
import type { DesignElement, HouseFootprint, Point, SiteSection } from '@garden-studio/schema';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { SHADOW_OPACITY } from '@/lib/materials/light';
import { useShadowLayer } from '@/lib/materials/use-shadow-layer';

/**
 * The plan's cast shadows, as one composited image.
 *
 * **Where this sits in the stack matters and is not obvious.** It goes above every surface and
 * below every feature, inside the elements layer rather than as a layer of its own:
 *
 * ```
 *   base fills      ── the ground
 *   accent fills    ── beds and borders on it
 *   ▶ SHADOWS ◀     ── marks belonging to one object, landing on another
 *   features        ── trees and structures, drawn OVER their own shadow
 *   fence, house
 * ```
 *
 * Shadows fall *on* surfaces, so they must be above them. But a tree stands up out of the ground
 * and has to be drawn over the shadow it casts, so they must be below features. Inserting at that
 * seam inside the existing layer preserves the array-order guarantee exactly, where splitting the
 * elements into two Konva layers would not.
 *
 * The whole image is drawn once at `SHADOW_OPACITY`. Everything inside it was filled opaque, so
 * two overlapping shadows composite as one — see `SHADOW_TONE`.
 *
 * Renders nothing at all when the plan has never said where it is, when the sun is below the
 * horizon, or when nothing on the plan has height. Silence is the honest output there: a shadow
 * drawn from a guessed latitude is a claim the user never made.
 */
export function ShadowLayer({
  elements,
  house,
  boundary,
  site,
  transform,
}: {
  elements: DesignElement[];
  house: HouseFootprint | null;
  boundary: Point[];
  site: SiteSection;
  transform: CanvasTransform;
}) {
  const layer = useShadowLayer(elements, house, boundary, site, transform.scale);

  if (!layer) return null;

  const at = metresToPx(layer.originMetres, transform);

  return (
    <KonvaImage
      // Konva types this as `HTMLImageElement` but hands it straight to `drawImage`, which takes
      // a canvas too. The cast is the type being narrower than the runtime — the same one
      // `fillPatternImage` already needs.
      image={layer.image as unknown as HTMLImageElement}
      x={at.x}
      y={at.y}
      scaleX={layer.scale}
      scaleY={layer.scale}
      opacity={SHADOW_OPACITY}
      listening={false}
    />
  );
}
