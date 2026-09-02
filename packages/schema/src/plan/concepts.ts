import { z } from 'zod';
import { PointSchema, type Point } from '../geometry/primitives.js';
import {
  geometryAnchor,
  geometryArea,
  geometryOutline,
  PlanGeometrySchema,
  type PlanGeometry,
} from './features.js';
import { BudgetBandSchema, DesiredFeatureSchema, MaintenanceLevelSchema } from './brief.js';
import { formatArea, formatLength, formatLengthValue, type Unit } from './units.js';
import { ZoneIdSchema } from './zone-id.js';

/**
 * What a generated design concept is, as data.
 *
 * The mockup for this screen shows photorealistic top-down renders. Nothing here is an image:
 * a concept is a list of geometry in the same metres-origin-top-left frame as steps 1 and 2,
 * drawn by the same Konva canvas. That is what makes a concept measurable, editable and
 * eventually costable rather than a picture of a garden.
 *
 * Generation runs in two stages and lands both in the same `elements` array, told apart by
 * `role`:
 *
 *   1. explicit elements — the features the brief asked for, placed inside the chosen zones;
 *   2. a fill pass — every remaining part of every chosen zone given a default surface, so a
 *      concept reads as a finished garden rather than a few shapes floating on graph paper.
 */

export const ElementCategorySchema = z.enum([
  'lawn',
  'planting-bed',
  'paved-area',
  'gravel-mulch',
  'structure',
  'water-feature',
  'existing-feature',
]);
export type ElementCategory = z.infer<typeof ElementCategorySchema>;

/** Whether this element is something the brief asked for, or ground cover under it. */
export const ElementRoleSchema = z.enum(['feature', 'fill']);
export type ElementRole = z.infer<typeof ElementRoleSchema>;

export const DesignElementSchema = z.object({
  id: z.string(),
  category: ElementCategorySchema,
  role: ElementRoleSchema,
  /**
   * Only meaningful for `role: 'feature'`. Fill regions are background — labelling every
   * patch of lawn would bury the things the user actually asked for.
   */
  name: z.string().optional(),
  shape: PlanGeometrySchema,
  zone: ZoneIdSchema,

  /* ---- step 5 adds the rest. All optional, so a generated concept is still a valid layout. ---- */

  /**
   * Which layer of the fill pass this is. `base` is the sheet laid over a whole zone to guarantee
   * coverage; `accent` is a bed drawn on top of it. Meaningless for `role: 'feature'`.
   *
   * Recorded explicitly rather than inferred from "its polygon equals the zone polygon", because
   * that stops being true the moment the editor touches anything, and the editor is precisely
   * where the distinction has to hold.
   */
  fillKind: z.enum(['base', 'accent']).optional(),
  /**
   * Material id from the catalogue in `materials.ts`. Absent means the category default.
   *
   * A plain string rather than the `MaterialId` enum on purpose: a stored document must not
   * become unparseable because the catalogue was edited, and this file would otherwise have to
   * import the catalogue that already imports `ElementCategory` from it. The planner validates
   * a material against its category at the point of use, where a bad id can be refused with a
   * sentence rather than a schema error.
   */
  material: z.string().optional(),
  /**
   * Where this surface's material pattern starts, and which way its courses run.
   *
   * Presentation anchoring, not geometry: nothing here changes the outline, the area or what the
   * validator sees. It is on the document rather than in browser state because it is a real design
   * decision — which way the decking boards run is something a landscaper would specify — and it
   * has to survive a reload like every other one.
   *
   * Optional, so a generated concept is still a valid layout and a stored plan written before this
   * field existed still parses. `patternAnchor` resolves the absent case to the *plan* origin
   * rather than the shape's own corner, which is what makes two adjacent patios share one grid
   * instead of each starting a fresh course at its own edge.
   */
  pattern: z
    .object({
      origin: PointSchema,
      /** Degrees clockwise, the same convention as `rect.rotation` and `ST_Rotate`. */
      rotation: z.number().default(0),
    })
    .optional(),
  /** Metres above grade. Carried for costing later; nothing renders differently because of it. */
  elevation: z.number().optional(),
  /**
   * How tall the thing itself is, in metres. **Not `elevation`** — that is where its base sits,
   * this is how far it rises from there, and a raised bed has both.
   *
   * Optional because `heightFor` resolves the absent case from the material and then the
   * category, which covers every surface and most planting. It is here for the cases neither can
   * know: a pergola and a raised bed are both `structure` built from `softwood`, and they are
   * 2.4 m and 0.45 m. The placer knows which it is placing, so it sets this.
   *
   * Real data rather than presentation, which is why it is on the document and its manifest is
   * in this package: the shadow it produces is a claim about the garden, and the server has to
   * be able to read it.
   */
  height: z.number().nonnegative().optional(),
  /** Hidden from the plan and from the area summary, without being deleted. */
  hidden: z.boolean().optional(),
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

export const RequestedFeatureCheckSchema = z.object({
  feature: DesiredFeatureSchema,
  label: z.string(),
  /** False when the generator could not fit it — the right panel reads this, never a literal. */
  included: z.boolean(),
});
export type RequestedFeatureCheck = z.infer<typeof RequestedFeatureCheckSchema>;

export const GeneratedConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  recommended: z.boolean(),
  summary: z.string(),
  /** Display text, not a `StyleDirection` — a concept may blend two ("Modern / Natural"). */
  style: z.string(),
  /** The position this concept takes on the brief's budget — what it is *aiming* at. */
  budget: BudgetBandSchema,
  /**
   * What the materials it actually used come to, area-weighted, on the same four bands.
   *
   * A band rather than a figure in pounds, deliberately: `Material.cost` is a rough relative 1-to-4
   * and turning it into currency would be inventing a number nothing here can support. Expressing
   * it in the same vocabulary the user chose from on step 3 also makes "does this match what they
   * asked for" a question with an answer.
   *
   * Optional so a concept generated before this existed still parses.
   */
  estimatedBudget: BudgetBandSchema.optional(),
  maintenance: MaintenanceLevelSchema,
  requestedFeaturesIncluded: z.array(RequestedFeatureCheckSchema).default([]),
  /**
   * Render order IS array order: base fills, then accent fills, then features. Coverage of a
   * zone is therefore a property of the stack rather than of the arithmetic that produced it,
   * which is what lets the fill pass leave no visible hole even when its geometry is
   * approximate.
   */
  elements: z.array(DesignElementSchema).default([]),
});
export type GeneratedConcept = z.infer<typeof GeneratedConceptSchema>;

export const ConceptsSectionSchema = z.object({
  concepts: z.array(GeneratedConceptSchema).default([]),
  selectedId: z.string().nullable().default(null),
  /** The one the user committed to on step 4. Survives regeneration until they choose again. */
  chosenConceptId: z.string().nullable().default(null),
  /** Advanced on every roll, so a regenerate cannot reproduce what is already on screen. */
  seed: z.number().int().nonnegative().default(1),
});
export type ConceptsSection = z.infer<typeof ConceptsSectionSchema>;

export const LayoutSectionSchema = z.object({
  elements: z.array(DesignElementSchema).default([]),
  /** Concept id this layout came from. A change to the chosen concept re-seeds it. */
  seededFrom: z.string().nullable().default(null),
  /**
   * The concept exactly as generated, so "Reset to concept" has something true to go back to.
   * Stored rather than derived because it cannot be recovered once the concept is regenerated.
   */
  pristine: z.array(DesignElementSchema).nullable().default(null),
});
export type LayoutSection = z.infer<typeof LayoutSectionSchema>;

/**
 * Whether the editor may reshape this element.
 *
 * Base fills are the ground the rest of the plan sits on: step 4 guarantees no chosen zone shows
 * bare grid by laying one over each zone, and that guarantee is only worth anything if step 5
 * cannot quietly delete or shrink it. They stay selectable and their material stays changeable —
 * turning the lawn into gravel is a real design decision — but their outline is fixed.
 */
export function isLocked(element: DesignElement): boolean {
  return element.role === 'fill' && element.fillKind === 'base';
}

/* ---------------------------------------------------------------- derived reads */

export function elementOutline(element: DesignElement): Point[] {
  return geometryOutline(element.shape);
}

export function elementAnchor(element: DesignElement): Point {
  return geometryAnchor(element.shape);
}

export function elementArea(element: DesignElement): number {
  return geometryArea(element.shape);
}

/**
 * The pattern grid's origin, in metres. The plan's own origin, deliberately.
 *
 * Anchoring each surface to its own bounding box would make paving continuous *within* a shape and
 * discontinuous between two that touch — the seam every real patio is laid to avoid. One shared
 * origin makes continuity the default and re-anchoring an explicit choice.
 */
export const DEFAULT_PATTERN_ORIGIN: Point = { x: 0, y: 0 };

/**
 * Where an element's pattern is anchored, resolved. Total by construction: the renderer's own
 * signature takes an origin and a rotation as required arguments, so it can never be the thing
 * that decides what an unanchored surface means.
 */
export function patternAnchor(element: DesignElement): { origin: Point; rotation: number } {
  return element.pattern ?? { origin: DEFAULT_PATTERN_ORIGIN, rotation: 0 };
}

/**
 * The size line under a feature's name — "5.2 × 3.8 m" for a rectangle, a run width for a
 * path, an area for a free-form shape, nothing at all for a point.
 *
 * Every number here is measured off the geometry, so a label can never disagree with the shape
 * it is pointing at. The assistant's before/after strings come through here too, which is why
 * it lives in the shared package rather than in the editor.
 */
export function describeElement(element: DesignElement, unit: Unit): string | null {
  return describeGeometry(element.shape, unit);
}

export function describeGeometry(shape: PlanGeometry, unit: Unit): string | null {
  switch (shape.kind) {
    case 'point':
      return null;
    case 'rect':
      // The unit is written once, on the second number — "5.2 × 3.8 m".
      return `${formatLengthValue(shape.width, unit)} × ${formatLength(shape.depth, unit)}`;
    case 'polyline':
      return `${formatLength(shape.width, unit)} wide`;
    case 'polygon':
      return formatArea(geometryArea(shape), unit);
  }
}

export function featureElements(concept: GeneratedConcept): DesignElement[] {
  return concept.elements.filter((element) => element.role === 'feature');
}

export function fillElements(concept: GeneratedConcept): DesignElement[] {
  return concept.elements.filter((element) => element.role === 'fill');
}

/** How much of a concept's requested features actually made it in. */
export function countIncluded(concept: GeneratedConcept): { included: number; total: number } {
  return {
    included: concept.requestedFeaturesIncluded.filter((check) => check.included).length,
    total: concept.requestedFeaturesIncluded.length,
  };
}
