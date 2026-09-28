import type { Point } from '../../geometry/primitives.js';
import type { BudgetBand, StyleDirection } from '../brief.js';
import type { DesignElement } from '../concepts.js';
import type { PrivacyStrategy } from '../design/vocabulary.js';
import type { MaterialId } from '../materials.js';
import { STRUCTURE_SIDES } from './config.js';
import {
  applyStructurePreset,
  presetFor,
  structureDefinitionFor,
  type SideInfill,
  type StructureDefinition,
} from './definitions.js';
import type { StructurePreset } from './presets.js';
import { sideSurroundings, type SurroundingsContext } from './surroundings.js';

/**
 * Turning a structure the planner has placed into one that is ready to use: the step between "a
 * 3.6 m square here" and "a slatted timber pergola, open to the terrace, screened from next door".
 *
 * Pure, deterministic and geometry-honest: it may turn the rect's *description* (below) and clamp an
 * oversized rect down about its centre, and it touches nothing else about where the structure is.
 * The generator calls it on every structure it places; the editor or the assistant can call it
 * later for the same answer, which is why it lives here rather than in the generator.
 */

interface RectShape {
  kind: 'rect';
  centre: Point;
  width: number;
  depth: number;
  rotation: number;
}

/**
 * The same rectangle described a quarter turn round: rotation plus `90·k`, width and depth swapped
 * for an odd `k`. **The ring is identical** — the validator, the schedule and every rotation reader
 * (which fold by 90°) cannot tell the difference — but the rect's *local* frame turns, and that frame
 * is what says which side is the front.
 *
 * This is how a structure's way in is pointed somewhere without storing a "front": the parts
 * builder, the plan symbol, the shadows and the future AR builder all read the rect-local frame, so
 * a stored front would have to be applied in each of them, and they would drift.
 */
export function reexpressRect<T extends RectShape>(rect: T, quarterTurns: number): T {
  const k = ((quarterTurns % 4) + 4) % 4;
  if (k === 0) return rect;
  const odd = k % 2 === 1;
  return {
    ...rect,
    width: odd ? rect.depth : rect.width,
    depth: odd ? rect.width : rect.depth,
    rotation: normaliseDegrees(rect.rotation + 90 * k),
  };
}

/** The world direction a rect's open front faces. */
export function frontDirection(rect: { rotation?: number }): Point {
  const radians = ((rect.rotation ?? 0) * Math.PI) / 180;
  return { x: -Math.sin(radians), y: Math.cos(radians) };
}

/**
 * The structure re-described so its open front faces `towards` as nearly as a quarter turn allows.
 * The ring does not move. Idempotent, and a no-op for anything that is not a rect.
 */
export function orientStructure(element: DesignElement, towards: Point): DesignElement {
  const { shape } = element;
  if (shape.kind !== 'rect') return element;
  const to = { x: towards.x - shape.centre.x, y: towards.y - shape.centre.y };
  if (Math.hypot(to.x, to.y) < 1e-6) return element;

  let best = 0;
  let bestDot = -Infinity;
  for (let k = 0; k < 4; k += 1) {
    const front = frontDirection({ rotation: shape.rotation + 90 * k });
    const dot = front.x * to.x + front.y * to.y;
    // Strictly better only, so a tie keeps the description the rect already had.
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = k;
    }
  }
  const rect = { ...shape, rotation: shape.rotation ?? 0 };
  return best === 0 ? element : { ...element, shape: reexpressRect(rect, best) };
}

/** What the configurer knows about the design it is configuring for. */
export interface StructurePolicy {
  style: StyleDirection | null;
  budget: BudgetBand;
  /** Whether the concept is lit at all — the same gate as its lighting scheme. */
  lit: boolean;
  privacy?: PrivacyStrategy | null;
  /**
   * Keep a timber frame the element already has (the generator's `materialFor` answer, which the
   * cost band was worked out from) where the chosen preset is timber too.
   */
  keepFrame?: boolean;
}

const DEAR: BudgetBand[] = ['high', 'premium'];
const CRISP_STYLES: (StyleDirection | null)[] = ['modern', 'lowMaintenance'];

/**
 * Which starting bundle suits the brief. A small table rather than a score, on purpose — it is read
 * by a person deciding whether the generator chose well.
 *
 * - A modern or minimalist brief that can afford it gets the aluminium frame it would be sold in.
 * - A gazebo on any other brief is the hipped timber one; a pergola at the top budget gets a covered
 *   roof, because a dry table is what the extra money buys.
 * - Everything else is the classic slatted timber frame.
 */
export function chooseStructurePreset(
  definition: StructureDefinition,
  policy: StructurePolicy,
): StructurePreset {
  const pick = (id: string) => presetFor(definition, id) ?? definition.presets[0]!;
  if (CRISP_STYLES.includes(policy.style) && DEAR.includes(policy.budget)) return pick('modern');
  if (definition.symbol === 'pergola' && policy.budget === 'premium') return pick('covered');
  return pick('classic');
}

/** The frames that are timber. A kept frame must stay timber, or "keep" would change the look. */
const TIMBER_FRAMES: MaterialId[] = [
  'hardwood',
  'softwood',
  'dark-stained-timber',
  'painted-timber',
];

/** How far out a side is read for "faces the boundary". A border's depth plus a path. */
export const SCREEN_REACH = 1.5;

/** Privacy readings that ask for a structure's boundary sides to be screened. */
const SCREENING: (PrivacyStrategy | null | undefined)[] = ['screen-neighbours', 'enclose'];

/**
 * A placed structure made ready: turned so its way in faces `towards`, given a preset's whole look,
 * its boundary-facing sides screened where the brief wants privacy, an explicit height, and — only
 * if the placer made it bigger than the product exists — clamped down about its centre.
 *
 * Returns the element unchanged when it is not a configurable structure.
 *
 * **Never grows it, and never moves it.** A clamp only ever shrinks the rect about its own centre,
 * so a structure that was inside the boundary and clear of everything is still both.
 */
export function configureStructure(
  element: DesignElement,
  policy: StructurePolicy,
  site: SurroundingsContext & { towards: Point | null },
): DesignElement {
  const definition = structureDefinitionFor(element);
  if (!definition || element.shape.kind !== 'rect') return element;

  const oriented = site.towards ? orientStructure(element, site.towards) : element;
  const clamped = clampToDefinition(oriented, definition);
  const preset = chooseStructurePreset(definition, policy);
  const dressed = applyStructurePreset(clamped, preset.id);

  const keep =
    policy.keepFrame &&
    TIMBER_FRAMES.includes(element.material as MaterialId) &&
    TIMBER_FRAMES.includes(preset.frame) &&
    definition.frameMaterials.includes(element.material as MaterialId);
  const material = keep ? element.material! : dressed.material!;

  // Which sides face the boundary, reading past planting and paths to the fence itself.
  const facing = sideSurroundings(dressed, site, { reach: SCREEN_REACH, filter: () => false });
  const screen = SCREENING.includes(policy.privacy);
  const sides = Object.fromEntries(
    STRUCTURE_SIDES.map((side) => {
      const onBoundary = facing[side]?.neighbour.kind === 'boundary';
      const infill: SideInfill =
        onBoundary && (screen || preset.sides[side] === 'slatted') ? 'slatted' : 'open';
      return [side, infill];
    }),
  ) as Record<(typeof STRUCTURE_SIDES)[number], SideInfill>;

  return {
    ...dressed,
    material,
    structure: {
      ...dressed.structure,
      sides,
      lighting: policy.lit && preset.lighting,
    },
  };
}

/** Clamp a rect down to the definition's largest size, about its centre. Never grows it. */
function clampToDefinition(element: DesignElement, definition: StructureDefinition): DesignElement {
  const { shape } = element;
  if (shape.kind !== 'rect') return element;
  const width = Math.min(shape.width, definition.dimensions.width.max);
  const depth = Math.min(shape.depth, definition.dimensions.depth.max);
  if (width === shape.width && depth === shape.depth) return element;
  return { ...element, shape: { ...shape, width, depth } };
}

function normaliseDegrees(degrees: number): number {
  const turned = degrees % 360;
  return turned < 0 ? turned + 360 : turned;
}
