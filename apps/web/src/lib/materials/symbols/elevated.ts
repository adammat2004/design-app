import type { Point } from '@garden-studio/schema';
import { RISE } from '../../render/camera';
import {
  ASSET_FAMILIES,
  elevatedAnchor,
  elevatedFrame,
  type AssetFamily,
  type AssetId,
} from '../assets/asset-spec';
import { cssToRgb, rgbToCss, shiftBrightness } from '../light';
import type { RectShape } from './structures';

/**
 * The small amount of arithmetic the elevated view needs that is not geometry.
 *
 * Pure, so both backends share it — the same rule `structures.ts` and `property.ts` follow, and the
 * same reason: a drawing decision that lives in one painter is a drawing decision the other painter
 * will eventually disagree with.
 */

/**
 * How much lighter or darker a vertical face is than the material it is made of.
 *
 * Larger than the module bevel (`MODULE_HIGHLIGHT` 0.07) because this is a whole wall rather than a
 * 10 mm arris, and smaller than a literal reading of the light would give, because the ambient term
 * in a garden is high: the sky is a very large light source and a wall facing away from the sun is
 * nothing like black. Overdo it and the drawing stops being a plan and starts being a render of a
 * model, which is precisely what the brief asks not to happen.
 */
export const FACE_SHADING = 0.17;

/**
 * How far a skinned face is pulled towards its material's own tone and its own light.
 *
 * A skin is a photograph of a material lit flat, because the renderer is what knows which way this
 * particular face is pointing. This is the wash that tells it: the same tone an unskinned face
 * would have been filled with, laid over the photograph at a fraction. Too little and every wall of
 * a building looks identically lit; too much and the boards disappear under a flat colour and the
 * skin was pointless.
 */
export const FACE_SKIN_TINT = 0.38;

/**
 * The house's own walls, seen from outside.
 *
 * Deliberately **not** `COLOUR.houseWall`, which is the dark slate the flat diagram draws its wall
 * band in. That works there because the band is a two-pixel outline whose job is to say where the
 * building stops. Here the same tone is a metre and a quarter of solid colour directly under a
 * slate roof, and the two read as one dark mass — the wall disappears and the roof simply looks
 * like it got blurry at the bottom.
 *
 * A warm off-white render instead: the commonest finish, the quietest against planting, and the
 * same material `skin-render` is written for, so the untextured fallback and the photographed
 * version are the same colour. The house is the one thing in the garden with no `material`, so
 * unlike every other face this tone cannot be looked up and has to be stated.
 */
export const HOUSE_WALL_TONE = '#d6cfc3';

/**
 * How much of a building's height the drawing lifts it by, at most, in metres.
 *
 * ## Why a cap exists at all
 *
 * A two-storey house is six metres to the eaves, which lifts its roof 1.27 m up the screen — and
 * everything in that 1.27 m strip of garden disappears underneath it. On the reference fixture that
 * is the whole near half of a dining set: real design content, hidden by context.
 *
 * The projection is not wrong to do it. A real aerial photograph taken from the south hides the
 * ground immediately north of a house in exactly this way. But a garden plan is a drawing *of the
 * garden*, and the house is there to give it scale and orientation, so trading a metre of garden
 * for a taller picture of somebody's wall is the wrong way round.
 *
 * ## Why four and a half metres, where it was three
 *
 * Three was measured off the reference: the wall band there is about 7% of the roof's depth, which
 * on a nine-metre house is 0.63 m, and `3 × RISE` is 0.64 m. That reading is sound and it was the
 * *wrong measurement to take*, because the reference is an aerial photograph of a garden in which
 * the house is almost out of frame — so its wall band says how much wall a camera happened to
 * catch, not how much wall a drawing needs to show a building.
 *
 * What the drawing needs is enough wall to carry the thing that makes a building read as one: its
 * **openings**. A patio door is 2.1 m tall standing on the ground, and at a three-metre cap the
 * band is 0.64 m of screen with a door filling two thirds of it and nothing above — no eaves line,
 * no wall, no first floor. 4.5 m gives 0.96 m of screen: the door, a course of wall over it, and a
 * strip of the storey above, which is what the eye needs to read the object as a house rather than
 * as a fence with a roof.
 *
 * The cost is real and is the reason it is capped at all: a further 0.32 m of garden disappears
 * behind the building. Judged on `01-suburban-visualise.png`, where the house is at the top of the
 * plot and the strip it hides is the strip a real aerial hides too.
 *
 * ## What it does not touch
 *
 * The **shadow**. `shadowOccluders` reads `houseHeight` and casts from the real eaves, so a
 * two-storey house still throws a two-storey shadow across the garden at four o'clock. The two are
 * separate systems and this is only about the drawing; conflating them would have a tall house stop
 * shading its own garden, which is a fact about the site rather than a drawing convention.
 */
export const MAX_DRAWN_LIFT = 4.5;

/** A height, capped for drawing. See `MAX_DRAWN_LIFT`. */
export function drawnLift(height: number): number {
  return Math.min(height, MAX_DRAWN_LIFT);
}

/**
 * The shade an overhanging roof throws on the wall below it, in metres and in opacity.
 *
 * Shallower than the eaves actually project, deliberately. A true shadow would be the overhang
 * times the sun's own geometry, which is `projectShadow`'s job and is already drawn on the ground;
 * this is the line under the eaves that says the roof stands proud of the wall, and it wants to
 * read at plan zoom rather than be correct at close zoom. Same class as `HOUSE_SHADOW_OFFSET`.
 */
export const EAVES_SHADOW_DEPTH = 0.16;
export const EAVES_SHADOW_ALPHA = 0.3;

/**
 * How far a garden building's roof oversails its own walls, in metres.
 *
 * Smaller than the house's, because it is: a shed's eaves project 150-250 mm where a house's
 * project a third of a metre or more. The number matters less than its existence — without any
 * oversail a shed is an extruded block with a line across it, and the ridge reads as a seam in a
 * panel rather than as a pitch.
 *
 * **Visualise only, and never near a measurement.** The same rule as `EAVES_OVERHANG`: it grows the
 * rectangle the *roof* is drawn from and nothing else. The deck beneath it, the footprint the
 * validator checks and the area the schedule counts all stay exactly what the document says.
 */
export const STRUCTURE_OVERHANG = 0.18;

/**
 * The symbols that have a roof to oversail.
 *
 * A pergola is an open frame — it has beams and no roof, so an overhang would be an eaves line
 * round thin air. A raised bed and a flight of steps have no roof at all. Everything here is a
 * building, and every one of them draws its roof from its own rect, which is what makes growing
 * that rect the whole of the change.
 */
export const ROOFED_SYMBOLS: ReadonlySet<string> = new Set([
  'shed',
  'gazebo',
  'garden-room',
  'greenhouse',
]);

/**
 * A door or a window seen on a wall face.
 *
 * Two tones and a rule about panes, which is all a window needs to read at this scale. Glass is
 * dark rather than light because that is what glass does when you look at it from outside on a
 * bright day: it reflects the sky at a glancing angle and shows the dark room at a steep one, and
 * this camera is steep. A pale panel would read as a blank panel.
 *
 * The frame is the thing that actually says "window". Drawn as a surround rather than a stroke so
 * it keeps a real width in metres and cannot vanish when the plan is zoomed out.
 */
export const GLAZING_TONE = '#41505c';
export const FRAME_TONE = '#eceae4';
/** Metres of frame around a pane. A real 60 mm section reads as nothing; this is a convention. */
export const FRAME_WIDTH = 0.09;
/** Wider than this and the opening is drawn in panes, because a 2.4 m sheet of glass is not one. */
export const MAX_PANE_WIDTH = 0.95;

/**
 * A face's own fill, given the material's tone and how squarely it faces the light.
 *
 * `lit` is `normal · light`, so a wall square into the sun gets the full highlight, one square away
 * gets the full shadow, and one edge-on gets the material unchanged. That continuity matters more
 * than the endpoints: a stepped lit/unlit pair — which is what `roofTones` does, and is right for
 * two roof planes that meet at a ridge — would make a curved or many-sided outline read as facets.
 */
export function faceFill(base: string, lit: number): string {
  return rgbToCss(shiftBrightness(cssToRgb(base), lit * FACE_SHADING));
}

/**
 * The same rectangle, seen at height.
 *
 * The lift is a rigid translation, so a rect at height is a rect with a moved centre — which is the
 * whole reason the elevated view can reuse the plan view's drawing wholesale. Raise the walls, move
 * the origin up by the height, and then draw **exactly what the plan draws**: the plan picture
 * becomes the top of the elevated picture, and a shed's roof, a pergola's beams and a gazebo's hips
 * are all drawn by the code that already draws them.
 */
export function liftRect<T extends RectShape>(rect: T, height: number): T {
  return { ...rect, centre: { x: rect.centre.x, y: rect.centre.y - height * RISE } };
}

/** How far up the screen a height lands, in pixels. What a painter translates its context by. */
export function liftPx(height: number, pxPerMetre: number): number {
  return height * RISE * pxPerMetre;
}

/**
 * The strip of ground a standing thing darkens at its own foot.
 *
 * A drawing convention in the contact-shadow class, not a solar claim — it says "this meets the
 * ground here", which is the one thing an oblique projection cannot say on its own. It earns its
 * place most on the faces the camera *cannot* see: a wall running up and down the screen shows no
 * face at all, so without this it has no bottom edge and appears to hover.
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

/* ---------------------------------------------------------------- placing an elevated sprite */

/**
 * Where an elevated sprite's image goes, in world metres.
 *
 * ## The rule, and why it is one line
 *
 * An elevated asset's image is its footprint with its height leaning up the screen above it, and
 * `elevatedAnchor` says where inside that image the thing is standing. So placing one is: scale the
 * image so its *footprint* matches the footprint the geometry gives, then put its anchor on the
 * ground point. Everything else — a pot, a sofa, a seven-metre tree whose canopy overhangs its
 * trunk in every direction — falls out of that without a special case.
 *
 * ## What is deliberately different from `spriteBox`
 *
 * `spriteBox` fits a plan sprite inside the element's rect and **turns it a quarter** when the two
 * aspects disagree, so a lounger reserved in a wide rect lies across it rather than being squashed.
 * That is right for a photograph taken from directly above, which has no front. An elevated asset
 * does have one, and the quarter-turn would lay it on its side — so the fit here is a plain contain
 * with no turn, and an asset whose proportions disagree with its rect simply sits smaller inside it.
 *
 * Returns `null` for a plan-camera family, which is the signal to use the old path. One decision,
 * in one place, so no painter has to ask what camera it is looking at.
 */
export interface ElevatedPlacement {
  /** Top-left of the image, world metres, before rotation. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The world point the image turns about: where the thing stands. */
  pivot: Point;
}

export function elevatedPlacement(
  id: AssetId | null | undefined,
  ground: Point,
  footprint: { width: number; depth: number },
): ElevatedPlacement | null {
  if (!id) return null;

  const family: AssetFamily | undefined = ASSET_FAMILIES[id];
  if (!family || family.camera !== 'elevated') return null;
  if (family.metres.w <= 0 || family.metres.h <= 0) return null;

  const frame = elevatedFrame(family);
  const anchor = family.anchor ?? elevatedAnchor(family);

  // Contain, never cover: an asset may sit smaller inside its rect, but it may never be cropped.
  const scale = Math.min(footprint.width / family.metres.w, footprint.depth / family.metres.h);
  if (!(scale > 0)) return null;

  const width = frame.w * scale;
  const height = frame.h * scale;

  return {
    x: ground.x - anchor.x * width,
    y: ground.y - anchor.y * height,
    width,
    height,
    pivot: ground,
  };
}

/**
 * How far an elevated plant may be turned: about fifteen degrees either way.
 *
 * The light is baked into the picture, so a full rotation rotates the sun with it and a bed ends up
 * lit from every direction at once — which is the single most obvious way a render gives itself
 * away, and the reason `DrawPass.light` exists at all. Vegetation is roughly symmetric about the
 * vertical, so a small turn buys the variety a full one would have and costs nothing.
 *
 * Structures never come through here: they are extruded from their own outlines and are correct at
 * any angle by construction. Furniture does not either — its visible face is `height × RISE`, four
 * pixels for a table at plan zoom, so it turns freely and the error is a few pixels of shading. See
 * `docs/visualise-asset-style.md` for the per-category reasoning.
 */
export const VEGETATION_MAX_ROTATION = (15 * Math.PI) / 180;

/**
 * A free rotation folded into that band, monotonically.
 *
 * A *mapping* rather than a clamp, and the difference matters: clamping would pile every plant onto
 * one of the two limits and the bed would read as two orientations. Mapping the full turn onto the
 * band keeps the distribution the sampler drew, just narrower — and because it is a pure function of
 * the value the sampler already produced, it consumes no draw and cannot disturb the sequence.
 */
export function foldRotation(rotation: number, limit = VEGETATION_MAX_ROTATION): number {
  const turns = rotation / (Math.PI * 2);
  const wrapped = turns - Math.floor(turns);
  return (wrapped * 2 - 1) * limit;
}
