'use client';

import { useMemo } from 'react';
import {
  shadowCast,
  shadowOccluders,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { getShadowLayer } from './shadow-cache';
import type { PatternCanvas, MakeCanvas } from './render-surface-pattern';

/**
 * The plan's cast shadows, as an image to draw.
 *
 * The second piece of React in this directory, and it exists for the same reason the first one
 * does: everything below it is a pure function of data, so the shadow renderer can be tested
 * against a real canvas in Node without mounting anything.
 *
 * `null` is the ordinary answer, not a failure. It means "draw no shadow layer at all", and it
 * covers every case where claiming to know where the shade is would be inventing something: the
 * plan has no location, the sun is below the horizon, or nothing on the plan has any height.
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
  return useMemo(() => {
    if (typeof document === 'undefined') return null;

    /*
     * The gate on every solar claim in the app. No location means the plan has never said where
     * it is, and a shadow drawn from a guessed latitude would be the design built confidently
     * around a fact the user never stated — the same failure `suggestedDoorWall` avoids by
     * offering the inferred patio door rather than applying it.
     */
    const cast = shadowCast(site);
    if (!cast) return null;

    if (boundary.length < 3) return null;

    const occluders = shadowOccluders(elements, house);
    if (occluders.length === 0) return null;

    const raster = getShadowLayer(
      { occluders, cast, boundary, pxPerMetre: scale },
      makeBrowserCanvas,
    );

    if (!raster) return null;

    return {
      image: raster.canvas,
      originMetres: raster.originMetres,
      scale: scale / raster.pxPerMetre,
    };
  }, [elements, house, boundary, site, scale]);
}
