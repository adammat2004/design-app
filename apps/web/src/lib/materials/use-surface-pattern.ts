'use client';

import { useMemo } from 'react';
import {
  elementOutline,
  patternAnchor,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { getSurfacePattern } from './pattern-cache';
import { resolvePattern } from './palette';
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
 * `null` is the ordinary answer rather than a failure: 26 of the 27 materials have no pattern in
 * this pass, and a point or a polyline has no meaningful one at all — a polyline passes its colour
 * to Konva as a *stroke*, which has no pattern equivalent.
 *
 * `scale` is `CanvasTransform.scale`, which is pixels per metre.
 */
export function useSurfacePattern(
  element: DesignElement,
  scale: number,
  /** Unit vector towards the light. Omitted means the conventional top-left drawing light. */
  light?: Point,
): SurfacePattern | null {
  const material = resolvePattern(element.material);
  const kind = element.shape.kind;
  const patternable = material !== null && (kind === 'polygon' || kind === 'rect');

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
      },
      makeBrowserCanvas,
    );

    if (!raster) return null;

    return {
      image: raster.canvas,
      originMetres: raster.originMetres,
      scale: scale / raster.pxPerMetre,
    };
  }, [material, patternable, element, scale, light]);
}
