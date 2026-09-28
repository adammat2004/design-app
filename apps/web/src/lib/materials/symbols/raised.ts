import type { Point } from '@garden-studio/schema';
import { RISE } from '../../render/camera';
import { cssToRgb, rgbToCss, shiftBrightness } from '../light';

/**
 * The small amount of arithmetic a thing standing proud of the ground needs that is not geometry:
 * how its visible face is lit, how far up the screen its top lands, and the mark it leaves where
 * it meets the ground. The plan's edging courses and retaining faces are drawn with it.
 *
 * Pure, so every painter shares it — the same rule `structures.ts` and `property.ts` follow, and
 * the same reason: a drawing decision that lives in one painter is a drawing decision another
 * painter will eventually disagree with.
 */

/**
 * How much lighter or darker a vertical face is than the material it is made of.
 *
 * Larger than the module bevel (`MODULE_HIGHLIGHT` 0.07) because this is a whole face rather than a
 * 10 mm arris, and smaller than a literal reading of the light would give, because the ambient term
 * in a garden is high: the sky is a very large light source and a face turned away from the sun is
 * nothing like black. Overdo it and the drawing stops being a plan and starts being a render of a
 * model.
 */
export const FACE_SHADING = 0.17;

/**
 * How far a skinned face is pulled towards its material's own tone and its own light.
 *
 * A skin is a photograph of a material lit flat, because the renderer is what knows which way this
 * particular face is pointing. This is the wash that tells it: the same tone an unskinned face
 * would have been filled with, laid over the photograph at a fraction. Too little and every face
 * looks identically lit; too much and the material disappears under a flat colour and the skin was
 * pointless.
 */
export const FACE_SKIN_TINT = 0.38;

/**
 * A face's own fill, given the material's tone and how squarely it faces the light.
 *
 * `lit` is `normal · light`, so a face square into the sun gets the full highlight, one square away
 * gets the full shadow, and one edge-on gets the material unchanged. That continuity matters more
 * than the endpoints: a stepped lit/unlit pair — which is what `roofTones` does, and is right for
 * two roof planes that meet at a ridge — would make a curved or many-sided outline read as facets.
 */
export function faceFill(base: string, lit: number): string {
  return rgbToCss(shiftBrightness(cssToRgb(base), lit * FACE_SHADING));
}

/** How far up the screen a height lands, in pixels. What a painter translates its context by. */
export function liftPx(height: number, pxPerMetre: number): number {
  return height * RISE * pxPerMetre;
}

/**
 * The strip of ground a standing thing darkens at its own foot.
 *
 * A drawing convention in the contact-shadow class, not a solar claim — it says "this meets the
 * ground here". It earns its place most on the faces that show no side at all: without it such a
 * face has no bottom edge and appears to hover.
 *
 * Returned as the quad between an edge and the same edge pushed **down** the screen, which is the
 * opposite direction from the lift and therefore always on the ground in front of the thing.
 */
export function footBand(start: Point, end: Point, depth: number): Point[] {
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
    { x: end.x, y: end.y + depth },
    { x: start.x, y: start.y + depth },
  ];
}

/** How deep that strip is, in metres, for a thing of a given height. Capped: it is a hint, not a shadow. */
export function footBandDepth(height: number): number {
  return Math.min(0.28, Math.max(0.06, height * 0.06));
}
