import {
  elementCentreline,
  elementOutline,
  patternAnchor,
  type DesignElement,
  type LocalFrame,
  type LocalPoint,
  type Point,
} from '@garden-studio/schema';
import { assetVersion, getAssetVariants } from '../materials/assets/registry';
import { resolveLayers } from '../materials/layers';
import { resolvePattern } from '../materials/palette';
import { getSurfacePattern } from '../materials/pattern-cache';
import type { MakeCanvas, PatternCanvas, PatternRaster } from '../materials/render-surface-pattern';
import { plantingExclusions } from '../materials/scene-passes';

/**
 * A ground surface in 3D is painted by the plan's own surface painter — the same slabs, courses,
 * joints and bond the 2D plan draws, at the right proportions — rather than a single photograph
 * tiled square across it. It asks the plan's raster cache, so a surface already painted for the
 * plan at a similar density is not painted twice.
 *
 * Planting is lifted out of the raster, as `build-scene.ts` lifts it for the plan: a bed here is its
 * soil, and the plants stand up out of it as geometry.
 */

/** Detail a surface is painted at in 3D: enough to see joints at editing distance. */
const PX_PER_METRE = 96;
/** The most a raster may measure per side, so a whole lawn does not become a 64 MB texture. */
const MAX_SIDE_PX = 2048;

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

/** The painted raster for one surface, or `null` where it has no pattern (a flat colour instead). */
export function surfaceRaster(
  element: DesignElement,
  elements: DesignElement[],
  light: Point | undefined,
): PatternRaster | null {
  if (typeof document === 'undefined') return null;
  const material = resolvePattern(element.material);
  const outline = elementOutline(element);
  if (!material || outline.length < 3) return null;

  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pxPerMetre = Math.min(PX_PER_METRE, MAX_SIDE_PX / Math.max(span, 1));
  const { origin, rotation } = patternAnchor(element);

  return getSurfacePattern(
    {
      elementId: element.id,
      material,
      outline,
      origin,
      rotation,
      pxPerMetre,
      light,
      assetVersion: assetVersion(),
      assets: getAssetVariants,
      layers: resolveLayers(material, element).filter((layer) => !layer.planting),
      centreline: elementCentreline(element) ?? undefined,
      plantingStyle: element.plantingStyle,
      element,
      exclusions: plantingExclusions(element, elements),
    },
    makeCanvas,
  );
}

/**
 * Where a local-frame point falls on a surface's raster, as texture coordinates. The raster covers
 * a world-metre box from its top-left corner with plan +y running down the image; a canvas texture
 * is flipped so its top row is v = 1.
 */
export function rasterUv(
  raster: PatternRaster,
  frame: LocalFrame,
): (point: LocalPoint) => [number, number] {
  const { originMetres, pxPerMetre, widthPx, heightPx } = raster;
  return (point) => {
    const plan = frame.toPlan(point);
    return [
      ((plan.x - originMetres.x) * pxPerMetre) / widthPx,
      1 - ((plan.y - originMetres.y) * pxPerMetre) / heightPx,
    ];
  };
}
