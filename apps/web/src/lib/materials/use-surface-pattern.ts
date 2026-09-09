'use client';

import { useMemo } from 'react';
import {
  isPlantSymbol,
  elementCentreline,
  elementOutline,
  patternAnchor,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { getAssetVariants } from './assets/registry';
import { useAssetVersion } from './assets/use-assets';
import { getSurfacePattern } from './pattern-cache';
import { resolvePattern } from './palette';
import { useDevicePixelRatio } from './use-device-pixel-ratio';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

/**
 * The only React in this directory.
 *
 * Everything below it is a pure function of data, so the renderer can be tested against a real
 * canvas in Node without mounting anything — the same split `canvas-transform.ts` keeps, and for
 * the same reason: react-konva's Node build pulls in the native `canvas` package and breaks under
 * test.
 */

/** What a surface needs to be drawn as an image. */
export interface SurfacePattern {
  image: PatternCanvas;
  /**
   * Where the raster's top-left corner sits, in **world metres**.
   *
   * Not pixels, and not relative to anything. The two canvases that draw an element put it in
   * different frames — the editor parks a group on the element's anchor so dragging can read the
   * node's own position, step 4 draws absolutely — and a hook that returned one of those would
   * silently misplace the texture on the other. Metres are the frame they already agree on.
   */
  originMetres: Point;
  /**
   * Scale to draw the image at, relative to `pxPerMetre`. Exactly 1 at a bucket boundary and up to
   * about 1.41 between two — the deliberate trade: soften slightly rather than redraw every frame
   * of a zoom.
   */
  scale: number;
}

/**
 * A browser canvas, not an `OffscreenCanvas`.
 *
 * Konva draws its `Image` through `drawImage`, which takes either — but it also reads `width` and
 * `height` off the source and holds it as a scene element, and an ordinary canvas element is the
 * case it is actually built around. There is no worker here to make the offscreen version worth
 * the risk.
 */
const makeBrowserCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return canvas as unknown as PatternCanvas;
};

/**
 * The raster for one element at one zoom, or `null` when it should be drawn as a flat fill.
 *
 * `null` is the ordinary answer rather than a failure: a material with no pattern, or a polyline —
 * which passes its colour to Konva as a *stroke*, and a stroke has no pattern equivalent.
 *
 * `scale` is `CanvasTransform.scale`, which is pixels per metre.
 */
export function useSurfacePattern(
  element: DesignElement,
  scale: number,
  /** Unit vector towards the light. Omitted means the conventional top-left drawing light. */
  light?: Point,
  /**
   * Whether this element is mid-drag or mid-resize. Passed in rather than read from the store, for
   * the reason `light` is: everything below this hook is a pure function of its arguments, and
   * reaching into state here would end that.
   */
  interacting = false,
  exclusions?: Point[][],
): SurfacePattern | null {
  const material = resolvePattern(element.material);
  const kind = element.shape.kind;
  /*
   * Every kind is patternable now: a point as the circle `circleRing` tessellates it to (a water
   * bowl is a disc of water, a fire pit a disc of bark), and a polyline as the strip
   * `polylineStrip` cuts for it — so a stepping-stone path is stones set in grass rather than the
   * grey stroke it used to be handed to Konva as. Trees are points too, but draw as a canopy.
   */
  /*
   * A plant drawn as a sprite needs no surface raster, and asking for one is not free: the cache is
   * keyed per element against `MAX_ENTRIES`, so thirty shrubs are thirty entries competing with the
   * patios and beds that actually use theirs. The sprite path in `ElementDrawing` returns before it
   * would ever read this, so the raster was allocated, cached, and never drawn.
   */
  const drawnAsSprite = kind === 'point' && isPlantSymbol(element.symbol);
  const patternable = material !== null && kind !== undefined && !drawnAsSprite;
  // Changes exactly once, when the textures arrive; every raster redraws with them at that moment.
  const assetVersion = useAssetVersion();
  // Ordinarily constant for a session, and changes only if the window moves to another display.
  const pixelRatio = useDevicePixelRatio();

  return useMemo(() => {
    // No document during SSR, and Konva is client-only here anyway.
    if (!material || !patternable || typeof document === 'undefined') return null;

    const outline = elementOutline(element);
    if (outline.length < 3) return null;

    const { origin, rotation } = patternAnchor(element);

    const raster = getSurfacePattern(
      {
        elementId: element.id,
        material,
        outline,
        origin,
        rotation,
        pxPerMetre: scale,
        light,
        assetVersion,
        assets: getAssetVariants,
        pixelRatio,
        interacting,
        centreline: elementCentreline(element) ?? undefined,
        plantingStyle: element.plantingStyle,
        element,
        exclusions,
      },
      makeBrowserCanvas,
    );

    if (!raster) return null;

    return {
      image: raster.canvas,
      originMetres: raster.originMetres,
      /*
       * The live CSS zoom over the density the raster was actually drawn at — which now carries the
       * pixel ratio, so this comes out proportionally smaller and the image is drawn at the same
       * world size as before, just with more pixels in it. Nothing at the call site changes.
       */
      scale: scale / raster.pxPerMetre,
    };
  }, [
    material,
    patternable,
    element,
    scale,
    light,
    assetVersion,
    pixelRatio,
    interacting,
    exclusions,
  ]);
}
