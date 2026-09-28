import type { Point } from '@garden-studio/schema';

/**
 * The WebGL backend's public face: the view types every caller shares, and the active renderer.
 *
 * `SceneRenderer` lives in `compositor.ts`. It is a **compositor**, not a second painter: every
 * surface it draws is a raster the Canvas2D painter produced, through the same `getSurfacePattern`
 * cache the Konva canvas uses, uploaded as a texture — so there is no second implementation of a
 * material to drift from the first. What WebGL is here for is the planting: a mature garden is a
 * few thousand plant sprites, and Pixi batches same-texture sprites into a handful of draw calls.
 *
 * Pixi v8 has no supported Node backend, so the browser compositor is tested with Playwright.
 * Under Vitest `buildRenderScene` is a pure function tested on its own: every decision about
 * *what* to draw is asserted before a renderer sees it.
 */

/** Where the camera is: metres per screen, and which world point is in the middle. */
export interface ViewTransform {
  pxPerMetre: number;
  /** Diagnostic comparison; only affects eligible low planting, not authored geometry. */
  plantingPreview?: import('../plant-clusters').PlantingPreview;
  /** World point at the centre of the viewport. */
  centre: Point;
}

/**
 * The viewport in CSS pixels.
 *
 * Passed in rather than measured here so that the WebGL layer and the 2D overlay drawn over it
 * take their frame from one measurement of one element. Device pixel ratio is the renderer's own
 * business and must not reach this.
 */
export interface ViewSize {
  width: number;
  height: number;
}

export { SceneRenderer } from './compositor';
