'use client';

import { useMemo } from 'react';
import {
  boundaryRuns,
  lightDirection,
  shadowOccluders,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { LIGHT_DIRECTION, presentationCast } from './light';
import { PRESENTATION_SHADOW_SOFTNESS } from './render-shadow-layer';
import { getShadowLayer } from './shadow-cache';
import type { PatternCanvas, MakeCanvas } from './render-surface-pattern';
import { useDevicePixelRatio } from './use-device-pixel-ratio';

/**
 * The plan's cast shadows, as an image to draw.
 *
 * The second piece of React in this directory, and it exists for the same reason the first one
 * does: everything below it is a pure function of data, so the shadow renderer can be tested
 * against a real canvas in Node without mounting anything.
 *
 * `null` is the ordinary answer, not a failure. It means "draw no shadow layer at all": a located
 * plan whose sun is below the horizon, a plot with no outline, or nothing on the plan with any
 * height. A plan that has never stated a location is no longer one of those cases — it draws the
 * conventional shadow every other drawing convention here already implies. See `presentationCast`.
 */
export interface ShadowLayer {
  image: PatternCanvas;
  /** Where the raster's top-left corner sits, in **world metres** — see `useSurfacePattern`. */
  originMetres: Point;
  /** Scale to draw the image at, relative to the live zoom. */
  scale: number;
}

const makeBrowserCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return canvas as unknown as PatternCanvas;
};

export function useShadowLayer(
  elements: DesignElement[],
  house: HouseFootprint | null,
  boundary: Point[],
  site: SiteSection,
  scale: number,
): ShadowLayer | null {
  const pixelRatio = useDevicePixelRatio();

  return useMemo(() => {
    if (typeof document === 'undefined') return null;

    /*
     * The real sun where the plan has stated a location, the drawing's own light where it has not,
     * and nothing where it has one and the sun is down. The solar claim is still gated —
     * `ShadowCast.source` says which this is — but the *picture* no longer loses its depth for
     * want of a latitude. See `presentationCast`.
     */
    const cast = presentationCast(site, lightDirection(site) ?? LIGHT_DIRECTION);
    if (!cast) return null;

    if (boundary.length < 3) return null;

    const occluders = shadowOccluders(elements, house, boundaryRuns(site));
    if (occluders.length === 0) return null;

    const raster = getShadowLayer(
      {
        occluders,
        cast,
        boundary,
        pxPerMetre: scale,
        pixelRatio,
        softnessMetres: PRESENTATION_SHADOW_SOFTNESS,
      },
      makeBrowserCanvas,
    );

    if (!raster) return null;

    return {
      image: raster.canvas,
      originMetres: raster.originMetres,
      scale: scale / raster.pxPerMetre,
    };
  }, [elements, house, boundary, site, scale, pixelRatio]);
}
