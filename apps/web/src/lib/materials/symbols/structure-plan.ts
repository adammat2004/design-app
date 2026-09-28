import {
  partHeights,
  partPlanOutline,
  resolveStructure,
  structureFinish,
  structureParts,
  type DesignElement,
  type Point,
  type StructurePart,
  type StructurePartGroup,
} from '@garden-studio/schema';
import { CONVENTIONAL_SHADOW_RATIO, cssToRgb, MODULE_HIGHLIGHT, MODULE_SHADOW, rgbToCss, shiftBrightness } from '../light';
import { facesLight, rectNormal } from './structures';

/**
 * A configurable structure — a pergola, a gazebo — as it is drawn on the plan.
 *
 * Read off `structureParts`, the same solids the 3D editor renders and the shadow model casts, so
 * the plan and the configurator cannot disagree about how many rafters there are or which side is
 * screened: the plan draws the parts seen from above, in their own finishes, and nothing else.
 * Pure geometry and colour in world metres, for the reason `structures.ts` is — the Konva canvas and
 * the composer both draw from it, and neither can be tested without a browser unless it is separable
 * from the drawing.
 *
 * The plan does **not** reproduce the 3D model. It shows what a plan should: where the posts stand,
 * which way the rafters run, whether the roof is open or solid, which sides are screened. The
 * finish is a tone, not a render.
 */
export interface StructurePlanPiece {
  group: StructurePartGroup;
  ring: Point[];
  fill: string;
  alpha: number;
}

export interface StructurePlanDrawing {
  /**
   * The rafters translated along the drawing light: the striped shade that is the one thing that
   * says "pergola" from above. A drawing convention in the contact-shadow class, drawn whether or not
   * the plan has a location, and only for an open roof — a solid one is a roof, and the cast layer
   * already shades what is under it.
   */
  slatShadows: Point[][];
  /** Bottom to top: posts, beams, screens, then the roof. */
  pieces: StructurePlanPiece[];
}

/** How much a roof covers what is under it. Under one, so the frame still reads through it. */
const ROOF_ALPHA = 0.72;
/** The lit stripe down the middle of a rafter, as a share of its width. */
const HIGHLIGHT_SHARE = 0.47;

const tone = (hex: string, amount: number) => rgbToCss(shiftBrightness(cssToRgb(hex), amount));

/**
 * The plan drawing of a configurable structure, or `null` when the element is not one.
 *
 * `light` is the drawing's own light, so the hipped roof's lit facets and the slat shadows agree
 * with every other shaded thing on the plan.
 */
export function structurePlanDrawing(element: DesignElement, light: Point): StructurePlanDrawing | null {
  const structure = resolveStructure(element);
  if (!structure || element.shape.kind !== 'rect') return null;

  const rect = { centre: element.shape.centre, rotation: element.shape.rotation };
  const parts = structureParts(structure);
  const colour = (part: StructurePart) => structureFinish(part.finish).baseColor;
  const pieces: StructurePlanPiece[] = [];
  const slatShadows: Point[][] = [];

  const ringOf = (part: StructurePart) => partPlanOutline(part, rect);

  for (const part of parts.filter((candidate) => candidate.group === 'post')) {
    pieces.push({ group: 'post', ring: ringOf(part), fill: tone(colour(part), -0.5), alpha: 1 });
  }
  for (const part of parts.filter((candidate) => candidate.group === 'beam')) {
    pieces.push({ group: 'beam', ring: ringOf(part), fill: tone(colour(part), -0.3), alpha: 1 });
  }
  /*
   * A screen seen from above is its top board: every board in it stands on the same line, so drawing
   * them all would lay the same strip down a dozen times. One per side is the honest plan.
   */
  for (const group of ['side-left', 'side-right', 'side-rear'] as const) {
    const top = parts.filter((candidate) => candidate.group === group).at(-1);
    if (top) pieces.push({ group, ring: ringOf(top), fill: tone(colour(top), -0.35), alpha: 1 });
  }

  for (const part of parts.filter((candidate) => candidate.group === 'rafter')) {
    const ring = ringOf(part);
    const { top } = partHeights(part);
    const reach = (Math.max(0, element.elevation ?? 0) + top) * CONVENTIONAL_SHADOW_RATIO;
    slatShadows.push(ring.map((point) => ({ x: point.x - light.x * reach, y: point.y - light.y * reach })));
    pieces.push({ group: 'rafter', ring, fill: tone(colour(part), -0.25), alpha: 1 });
    if (part.shape.kind === 'box') {
      const stripe: StructurePart = {
        ...part,
        shape: { ...part.shape, size: [part.shape.size[0] * HIGHLIGHT_SHARE, part.shape.size[1], part.shape.size[2]] },
      };
      pieces.push({ group: 'rafter', ring: ringOf(stripe), fill: tone(colour(part), 0.2), alpha: 1 });
    }
  }

  for (const part of parts.filter((candidate) => candidate.group === 'roof')) {
    const finish = structureFinish(part.finish);
    const alpha = finish.opacity ?? ROOF_ALPHA;
    if (part.shape.kind === 'pyramid') {
      /* Four hips meeting at the apex, lit and unlit from the one light — as `gazeboRoof` drew. */
      const ring = ringOf(part);
      const apex = {
        x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
        y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
      };
      const normals: Point[] = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ];
      ring.forEach((corner, index) => {
        const next = ring[(index + 1) % ring.length]!;
        const lit = facesLight(rectNormal(element.shape as { centre: Point; width: number; depth: number; rotation: number }, normals[index]!), light);
        pieces.push({
          group: 'roof',
          ring: [corner, next, apex],
          fill: tone(finish.baseColor, lit ? MODULE_HIGHLIGHT * 1.5 : -MODULE_SHADOW * 1.5),
          alpha,
        });
      });
    } else {
      pieces.push({ group: 'roof', ring: ringOf(part), fill: finish.baseColor, alpha });
    }
  }

  return { slatShadows, pieces };
}

/** Whether this element is drawn by `structurePlanDrawing` rather than by its own symbol. */
export function isConfigurableStructure(element: DesignElement): boolean {
  return resolveStructure(element) !== null;
}
