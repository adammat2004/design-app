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
import { EdgeTreatmentPlanSchema } from './edges/edge-run.js';
import { ConceptExplanationSchema, ConceptStrategySchema } from './design/concept-explanation.js';
import { DesignScoreSchema } from './design/design-score.js';
import { hashString } from './prng.js';
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
  /**
   * Things that stand *on* a surface rather than being one: a dining set, a lounger, a swing.
   *
   * Added when the plan started drawing sprites, because a garden with nowhere to sit is not a
   * garden design, and "put the table under the pergola" was the first edit everyone tried and
   * the one the assistant could not express. Furniture has an outline for placement and
   * selection, but no area anyone would schedule and no material anyone would lay.
   */
  'furniture',
  /**
   * Light fittings: a spike uplight in a bed, a bollard beside a path, a light in a step.
   *
   * **Not `furniture`, and the distinction is load-bearing rather than tidy.** Furniture is
   * *hosted*: a dining set sits on the terrace, and `concepts.service.test.ts` pins that as an
   * invariant — every furniture element must lie wholly inside exactly one built feature. Lighting
   * is the opposite by nature. A spike light stands in a planting bed, which is a `fill`; a bollard
   * runs beside a path, which is a polyline; a wall light is on the house, which is not an element
   * at all. Every one of those is zero hosts, so calling a light "furniture" would have meant
   * weakening the rule that keeps a dining set on its patio.
   *
   * Shares furniture's other properties, and `COUNTED_CATEGORIES` is where that is said once: an
   * outline for placing and selecting, no area anyone would schedule, counted in items rather than
   * square metres, and no weight in the cost index.
   */
  'lighting',
  'existing-feature',
]);
export type ElementCategory = z.infer<typeof ElementCategorySchema>;

/**
 * Categories measured in items rather than in square metres.
 *
 * `elementArea` of a dining set is 2.4 m² and of a bollard about 0.02 m², and neither is a
 * quantity anyone orders — the honest line is "1 item". Said once here so the schedule, the cost
 * index and the coverage sampler cannot disagree about which categories those are.
 */
export const COUNTED_CATEGORIES: ElementCategory[] = ['furniture', 'lighting'];

export function isCounted(category: ElementCategory): boolean {
  return COUNTED_CATEGORIES.includes(category);
}

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
  /**
   * Why this element is here, in one word from the composition's own vocabulary: `focal`,
   * `screening-planting`, `utility-route`, `destination`.
   *
   * The answer to "why is this here", recorded by the pass that put it there, so the explanation
   * and the editor can still say it after the plan has been stored — a generated concept is a
   * plan somebody edits a week later. A plain string for the reason `material` is one: the
   * vocabulary lives with the composition layer in the API and a stored plan must not become
   * unparseable because a word was added to it. Absent on anything placed by hand, on every plan
   * drawn before the composition layer existed, and on every fill: the scorer's `orphan-feature`
   * only asks about it on a plan where at least one element carries one.
   */
  purpose: z.string().max(48).optional(),

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
  /**
   * Which product this surface prefers where it is edged at all.
   *
   * **Not "this surface has a border round it"** — that is what `edges` decides, side by side and
   * stretch by stretch. This is the product `mode: 'auto'` lays *where the rules say to lay
   * something*, and what the generator stamps from the brief's style. Absent means the style picks
   * one (`styleEdgeProduct`), and where nothing is laid the product is never consulted.
   *
   * A `MaterialId` from `EDGING_MATERIALS`, which is deliberately not in `MATERIALS`: an edging run
   * is derived from the outline of the thing it edges, so there is no element to give a category
   * to. Only the four ground-covering categories may carry one — see `canBeEdged`.
   */
  edging: z.string().optional(),
  /**
   * What is built where this surface meets what is around it.
   *
   * **A treatment belongs to a run, not to a surface**, and that is the whole of this field. A
   * patio may want brick where it meets the lawn, nothing where it meets the path and nothing at
   * all against the house; one geometric side may need several treatments along its length. The
   * old model — one product for a whole outline — could say none of that.
   *
   * Absent is `mode: 'auto'`, so every plan written before this reads as one the rules decide, and
   * the field costs a stored document nothing. `none` is a real answer and not an empty one: it is
   * a surface somebody has said should be left bare.
   *
   * `runs` is read in `custom` alone. A run names a side, an end of it to measure from, and the two
   * distances in metres — never a fraction, for the reason `along-edge.ts` gives about gates — so
   * a 2.8 m course stays 2.8 m when the patio widens. Nothing here is a coordinate, and nothing
   * here is a second copy of the geometry: `plan/boundary/side-chains.ts` resolves the run against
   * the shape's *current* outline on every read, the way a door and a gate already resolve.
   */
  edges: EdgeTreatmentPlanSchema.optional(),
  /**
   * What this surface is retained in, where it does not sit on grade.
   *
   * A `MaterialId` from `WALLING_MATERIALS`, and meaningless without an `elevation` — the wall is
   * derived from the edge of the raised element, so with nothing raised there is no wall to build.
   * Absent is the default and a real answer: a plain upstand in the element's own paving, darkened,
   * which is what an in-situ concrete edge looks like. Same shape and same reasoning as `edging`.
   */
  retaining: z.string().optional(),
  /**
   * Metres above grade, positive up.
   *
   * **Drawn since `PLAN_DOCUMENT_VERSION` 3.** It was carried for costing and rendered by nothing;
   * now a raised element grows a retaining face (`plan/levels.ts`) and casts its shadow from the
   * top of the plinth it stands on. There is no ground model behind it — a level change is local to
   * the element that states one, and nothing anywhere infers a slope.
   */
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
  /**
   * What this element is, when its category cannot say: `pergola` or `shed` for a structure, a
   * `dining-set-4` for furniture. A `SymbolId` from `symbols.ts`, carried as a plain string for the
   * reason `material` is, and resolved by `resolveSymbol` at the point of use.
   */
  symbol: z.string().optional(),
  /** Catalogue identity, distinct from the broad drawing symbol. */
  plantId: z.string().optional(),
  /** Bed containing the plant centre; updated when it is moved. */
  bedId: z.string().optional(),
  /** Planning intent; omitted means a new proposed element. */
  status: z.enum(['keep', 'remove', 'replace']).optional(),
  /**
   * How a planting bed is planted — see `planting.ts`.
   *
   * A plain string, like `material` and `symbol`, and for the same reason: the catalogue of styles
   * will be edited, and a stored plan must never become unparseable because one was renamed.
   * `schemeFor` resolves an unknown value to the fallback rather than refusing it.
   *
   * Optional, so this is an addition with a default and **no `PLAN_DOCUMENT_VERSION` bump**: a bed
   * that says nothing gets the fallback scheme, which is what every bed drew before schemes
   * existed — a mixture — rather than nothing.
   *
   * Only meaningful on `planting-bed`. Storing it per element rather than per concept is what lets
   * the editor eventually change one bed's style without touching its neighbours.
   */
  plantingStyle: z.string().optional(),
  /** Hidden from the plan and from the area summary, without being deleted. */
  hidden: z.boolean().optional(),
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

export const RequestedFeatureCheckSchema = z.object({
  feature: DesiredFeatureSchema,
  label: z.string(),
  /** False when the generator could not fit it — the right panel reads this, never a literal. */
  included: z.boolean(),
  /**
   * Why it was left out, when it was. "The pond is missing" and "there was no room for the pond
   * without losing the lawn" are different answers and only the second is a design decision.
   *
   * Optional so a concept generated before the design agent existed still parses, and absent
   * rather than empty on an included feature — there is nothing to explain about a success.
   */
  reason: z.string().optional(),
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

  /* ---- what the design agent adds. All optional: a stored concept predates every one. ---- */

  /**
   * Which brief slot, layout archetype and candidate produced this concept.
   *
   * Nothing on the wire used to say which template a concept came from — it survived only as the
   * display `name`, so every test that wanted to identify one matched on the string, and "are these
   * two concepts the same shape of plan" could not be asked at all.
   */
  strategy: ConceptStrategySchema.optional(),
  /**
   * How the layout scored against the design principles, and what is wrong with it.
   *
   * Carried on the concept rather than kept server-side because it is the honest report of a
   * concept that was chosen from a field of fifty: a user comparing three plans is entitled to see
   * that one of them circulates badly. No authority over geometry — see `design/design-score.ts`.
   */
  score: DesignScoreSchema.optional(),
  /** Why this concept is the way it is: the decisions taken, in the order they were taken. */
  explanation: ConceptExplanationSchema.optional(),
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

/**
 * The garden as it was before an AI redesign, so the user can get it back after a reload.
 *
 * **Why this has to persist at all.** While the designer proposed a diff and waited for Apply, a
 * misreading cost nothing: you declined it. Now the designer performs the change and autosave
 * stores it within the second, so a reload with only session memory leaves no route back at all.
 * Undo history deliberately does not survive a reload; this is the one thing that must.
 *
 * **Why it is one record and not a stack, and why it holds only `before`.** A full element list is
 * about 17 KB on an ordinary garden, and the whole document travels on every autosave — three
 * revisions holding both sides would quadruple it for a feature used once in a while. One record
 * with one list is the same order of cost as `pristine`, which is already here for the same kind of
 * reason.
 *
 * `afterFingerprint` is how a reloaded session knows the plan is still what the run left: hash the
 * loaded elements and compare. Cheap, and it saves storing the second list — which is nearly always
 * `elements` anyway, since the offer to undo only stands while nothing else has been edited.
 *
 * Replay is not covered and is not meant to be: replaying needs the operation timeline, which holds
 * a copy of the element list per operation. That stays in session memory.
 */
export const DesignRevisionRecordSchema = z.object({
  id: z.string().max(80),
  /** What the person actually asked for, so the offer can name it. */
  request: z.string().max(1000),
  createdAt: z.number().int().nonnegative(),
  /** The garden before the redesign. What Undo and Compare restore. */
  before: z.array(DesignElementSchema),
  /** A hash of the garden the run left, to tell "untouched since" from "edited since". */
  afterFingerprint: z.string().max(40),
});
export type DesignRevisionRecord = z.infer<typeof DesignRevisionRecordSchema>;

export const LayoutSectionSchema = z.object({
  elements: z.array(DesignElementSchema).default([]),
  /** Concept id this layout came from. A change to the chosen concept re-seeds it. */
  seededFrom: z.string().nullable().default(null),
  /**
   * The concept exactly as generated, so "Reset to concept" has something true to go back to.
   * Stored rather than derived because it cannot be recovered once the concept is regenerated.
   */
  pristine: z.array(DesignElementSchema).nullable().default(null),
  /**
   * The last AI redesign, so it can be undone after a reload. An addition with a default, so every
   * stored plan reads back unchanged and no migration is needed.
   */
  revision: DesignRevisionRecordSchema.nullable().default(null),
});
export type LayoutSection = z.infer<typeof LayoutSectionSchema>;

/**
 * A stable hash of what a layout *is*, ignoring key order.
 *
 * Only the fields that make a garden a different garden: identity, shape, and the properties the
 * editor can change. A pattern origin or a re-render does not make it a different plan.
 */
export function layoutFingerprint(elements: DesignElement[]): string {
  const shape = elements.map((element) => [
    element.id,
    element.category,
    element.material ?? '',
    element.name ?? '',
    element.hidden === true,
    JSON.stringify(element.shape),
  ]);
  return hashString(JSON.stringify(shape)).toString(36);
}

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

/**
 * The line a pad run marches along, when this element has one.
 *
 * Only a polyline does — a path, a rill, a run of stepping stones — and for everything else this is
 * `null` and the pad painter falls back to laying its pads over the shape's bounding box.
 *
 * The centreline is the polyline's own points, not something recovered from the tessellated strip.
 * `polylineStrip` builds the ribbon by offsetting these along their normals, so going back the
 * other way would be re-deriving from a derivation — and would quietly break the moment the strip
 * gained a mitre limit or a cap. The geometry of record is the points; ask them.
 */
export function elementCentreline(element: DesignElement): Point[] | null {
  return element.shape.kind === 'polyline' ? element.shape.points : null;
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
