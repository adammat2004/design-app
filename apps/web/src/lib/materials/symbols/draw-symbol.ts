import { resolveSymbol, type DesignElement, type Point } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '../../concept-colours';
import { materialFill } from '../../material-colours';
import { CONTACT_SHADOW_SPRITE } from '../assets/material-assets';
import type { AssetLookup } from '../assets/registry';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  cssToRgb,
  MODULE_HIGHLIGHT,
  MODULE_SHADOW,
  rgbToCss,
  shiftBrightness,
} from '../light';
import type { PatternCanvas, PatternContext } from '../render-surface-pattern';
import { beamLines } from './canopy';
import { symbolSprite } from './sprites';
import {
  facesLight,
  gazeboRoof,
  pergolaPosts,
  raisedBedRails,
  rectNormal,
  shedRoof,
  type RectShape,
} from './structures';

/**
 * Draws an element's symbol into a 2D context: the sprite for furniture, the posts and beams or
 * the roof for a structure.
 *
 * The composer's half of the pair. The Konva canvas draws the same things from the same pure
 * geometry (`structures.ts`, `sprites.ts`) as React nodes, so it can select and drag them; this
 * is what a thumbnail, a PNG and the judging sheet draw. Everything here is over the surface the
 * caller already painted — a pergola's boards are its material, drawn by the surface painter;
 * this adds the posts.
 */

interface SymbolContext extends PatternContext {
  drawImage(image: PatternCanvas, dx: number, dy: number, dw: number, dh: number): void;
}

/** True when a symbol was drawn, so the caller knows the element is not a bare surface. */
export function drawSymbol(
  context: SymbolContext,
  element: DesignElement,
  pxPerMetre: number,
  light: Point,
  assets: AssetLookup | undefined,
  toPx: (point: Point) => Point,
): boolean {
  const sprite = symbolSprite(element, assets);

  if (sprite) {
    const { box, asset } = sprite;
    const centre = toPx(box.centre);
    const width = box.width * pxPerMetre;
    const height = box.height * pxPerMetre;

    drawContactShadow(context, assets, centre, Math.max(width, height) / 2, light);

    context.save();
    context.translate(centre.x, centre.y);
    context.rotate((box.rotation * Math.PI) / 180);
    context.drawImage(asset.image as PatternCanvas, -width / 2, -height / 2, width, height);
    context.restore();
    return true;
  }

  const symbol = resolveSymbol(element);
  const { shape } = element;
  if (!symbol || shape.kind !== 'rect') return false;

  switch (symbol) {
    case 'pergola':
      drawPergola(context, shape, pxPerMetre, toPx);
      return true;
    case 'shed':
      drawShed(context, element, shape, light, toPx);
      return true;
    case 'gazebo':
      drawGazebo(context, element, shape, light, toPx);
      return true;
    case 'raised-bed':
      drawRaisedBed(context, shape, toPx);
      return true;
    default:
      return false;
  }
}

function drawContactShadow(
  context: SymbolContext,
  assets: AssetLookup | undefined,
  centre: Point,
  radiusPx: number,
  light: Point,
): void {
  const shadow = assets?.(CONTACT_SHADOW_SPRITE)[0];
  if (!shadow) return;

  const reach = radiusPx * CONTACT_SHADOW_SCALE;
  const offset = radiusPx * CONTACT_SHADOW_OFFSET_RATIO;
  context.globalAlpha = CONTACT_SHADOW_ALPHA;
  context.drawImage(
    shadow.image as PatternCanvas,
    centre.x - light.x * offset - reach,
    centre.y - light.y * offset - reach,
    reach * 2,
    reach * 2,
  );
  context.globalAlpha = 1;
}

function fillRing(context: PatternContext, ring: Point[], toPx: (point: Point) => Point): void {
  context.beginPath();
  ring.forEach((point, index) => {
    const at = toPx(point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.closePath();
  context.fill();
}

/** The floor for drawing posts and beams individually: below it they merge into a block. */
export const MIN_STRUCTURE_DETAIL_PX = 40;

function drawPergola(
  context: SymbolContext,
  shape: RectShape,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  if (Math.min(shape.width, shape.depth) * pxPerMetre < MIN_STRUCTURE_DETAIL_PX) return;

  context.strokeStyle = CATEGORY_COLOURS.structure.stroke;
  context.lineWidth = 1.5;
  context.globalAlpha = 0.55;
  for (const [from, to] of beamLines(shape.centre, shape.width, shape.depth, shape.rotation)) {
    const a = toPx(from);
    const b = toPx(to);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.fillStyle = POST_TONE;
  for (const post of pergolaPosts(shape)) fillRing(context, post, toPx);
}

/** Posts read as darker timber end-grain; one tone for every pergola. */
const POST_TONE = '#5b4a36';

function drawShed(
  context: SymbolContext,
  element: DesignElement,
  shape: RectShape,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  const { lit, unlit } = roofTones(element);

  const roof = shedRoof(shape);
  // The second slope faces local +y when the ridge runs along x, and local +x otherwise.
  const secondNormal = rectNormal(
    shape,
    shape.width >= shape.depth ? { x: 0, y: 1 } : { x: 1, y: 0 },
  );
  const secondLit = facesLight(secondNormal, light);

  // Over the boards, not instead of them: the material still shows through the two pitches.
  context.globalAlpha = ROOF_ALPHA;
  context.fillStyle = secondLit ? unlit : lit;
  fillRing(context, roof.slopes[0], toPx);
  context.fillStyle = secondLit ? lit : unlit;
  fillRing(context, roof.slopes[1], toPx);
  context.globalAlpha = 1;

  const a = toPx(roof.ridge[0]);
  const b = toPx(roof.ridge[1]);
  context.strokeStyle = CATEGORY_COLOURS.structure.stroke;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function drawGazebo(
  context: SymbolContext,
  element: DesignElement,
  shape: RectShape,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  const { lit, unlit } = roofTones(element);

  const normals: Point[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  context.globalAlpha = ROOF_ALPHA;
  gazeboRoof(shape).forEach((facet, index) => {
    context.fillStyle = facesLight(rectNormal(shape, normals[index]!), light) ? lit : unlit;
    fillRing(context, facet, toPx);
  });
  context.globalAlpha = 1;
}

/** How much a roof's pitches cover the boards beneath. Under one, so a shed still reads as timber. */
export const ROOF_ALPHA = 0.72;

/** Lit and unlit pitches, from whatever colour `materialFill` already paints the element in. */
export function roofTones(element: DesignElement): { lit: string; unlit: string } {
  const tone = cssToRgb(materialFill(element));
  return {
    lit: rgbToCss(shiftBrightness(tone, MODULE_HIGHLIGHT * 1.5)),
    unlit: rgbToCss(shiftBrightness(tone, -MODULE_SHADOW * 1.5)),
  };
}

function drawRaisedBed(
  context: SymbolContext,
  shape: RectShape,
  toPx: (point: Point) => Point,
): void {
  const rails = raisedBedRails(shape);
  context.fillStyle = POST_TONE;
  fillRing(context, rails.outer, toPx);
  context.fillStyle = CATEGORY_COLOURS['planting-bed'].fill;
  fillRing(context, rails.inner, toPx);
}
