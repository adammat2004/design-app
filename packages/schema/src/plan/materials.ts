import { z } from 'zod';
import type { DesignElement, ElementCategory } from './concepts.js';

/**
 * What each surface is actually made of.
 *
 * A category says "this is paving"; a material says "this is natural stone rather than poured
 * concrete", which is the distinction that drives cost, upkeep and how the garden looks.
 *
 * Ids are an enum rather than free strings because the assistant hands them back: a closed set
 * is what stops the model inventing "reclaimed Yorkshire flagstone" and the planner having to
 * guess what it meant. The colour each material draws in is *not* here — that is presentation,
 * and it lives in the web app's `material-colours.ts` keyed off this enum, so a new material
 * without a colour is a compile error rather than a blank shape.
 */

export const MaterialIdSchema = z.enum([
  // paved-area
  'stone-pavers',
  'concrete',
  'porcelain',
  'stone-setts',
  'gravel-paving',
  'timber-decking',
  'stepping-stones',
  // lawn
  'standard-turf',
  'hardwearing-turf',
  'artificial-turf',
  'wildflower',
  // planting-bed
  'mixed-border',
  'shrubs',
  'ornamental-grasses',
  'hedging',
  'ground-cover',
  // gravel-mulch
  'bark-mulch',
  'decorative-gravel',
  'play-bark',
  'slate-chippings',
  // structure
  'softwood',
  'painted-timber',
  'dark-stained-timber',
  'hardwood',
  'powder-coated-steel',
  // water-feature
  'naturalistic-pond',
  'formal-pool',
  'rill',
  'water-bowl',
  // edging — not a category; see `EDGING_MATERIALS`
  'brick-edging',
  'concrete-kerb',
  'sett-edging',
  'timber-sleeper',
  'steel-edging',
  // walling — retaining, also not a category; see `WALLING_MATERIALS`
  'walling-stone',
  'brick-walling',
  'rendered-block',
  // lighting
  'black-aluminium',
  'brushed-steel',
  'antique-brass',
  // furniture
  'teak-furniture',
  'rattan-furniture',
  'steel-furniture',
  // existing-feature
  'existing',
]);
export type MaterialId = z.infer<typeof MaterialIdSchema>;

export interface Material {
  id: MaterialId;
  label: string;
  /** Rough relative cost, 1 (cheapest) to 4. Drives "make it cheaper" and, later, costing. */
  cost: 1 | 2 | 3 | 4;
}

/**
 * The first entry in each list is that category's default — `defaultMaterial` reads it from here
 * rather than from a second table that could disagree.
 */
export const MATERIALS: Record<ElementCategory, Material[]> = {
  'paved-area': [
    { id: 'stone-pavers', label: 'Natural stone pavers', cost: 4 },
    { id: 'concrete', label: 'Concrete', cost: 2 },
    { id: 'porcelain', label: 'Porcelain tiles', cost: 4 },
    { id: 'stone-setts', label: 'Stone setts', cost: 3 },
    { id: 'gravel-paving', label: 'Gravel', cost: 1 },
    { id: 'timber-decking', label: 'Timber decking', cost: 3 },
    { id: 'stepping-stones', label: 'Stepping stones', cost: 2 },
  ],
  lawn: [
    { id: 'standard-turf', label: 'Standard turf', cost: 1 },
    { id: 'hardwearing-turf', label: 'Hard-wearing turf', cost: 2 },
    { id: 'artificial-turf', label: 'Artificial turf', cost: 3 },
    { id: 'wildflower', label: 'Wildflower meadow', cost: 1 },
  ],
  'planting-bed': [
    { id: 'mixed-border', label: 'Mixed border', cost: 2 },
    { id: 'shrubs', label: 'Shrub planting', cost: 2 },
    { id: 'ornamental-grasses', label: 'Ornamental grasses', cost: 2 },
    { id: 'hedging', label: 'Hedging', cost: 3 },
    { id: 'ground-cover', label: 'Ground cover', cost: 1 },
  ],
  'gravel-mulch': [
    { id: 'bark-mulch', label: 'Bark mulch', cost: 1 },
    { id: 'decorative-gravel', label: 'Decorative gravel', cost: 2 },
    { id: 'play-bark', label: 'Play-grade bark', cost: 2 },
    { id: 'slate-chippings', label: 'Slate chippings', cost: 3 },
  ],
  structure: [
    { id: 'softwood', label: 'Treated softwood', cost: 1 },
    { id: 'painted-timber', label: 'Painted timber', cost: 2 },
    /*
     * The finish a garden building actually has, and the one the catalogue was missing.
     *
     * Every shed, store and garden room this app drew came out pale honey, because `softwood` is
     * the cheap default and a photograph of untreated softwood is what it is. A real garden
     * building is stained — and a dark one *recedes*, which is the whole reason designers specify
     * it: a store you can see from the house is a store you are looking at instead of the garden.
     * Same price band as paint, because it is the same job.
     */
    { id: 'dark-stained-timber', label: 'Dark-stained timber', cost: 2 },
    { id: 'hardwood', label: 'Hardwood', cost: 4 },
    { id: 'powder-coated-steel', label: 'Powder-coated steel', cost: 4 },
  ],
  /*
   * What furniture is made of. Never laid by area, so these never reach the schedule's unit counts
   * or the cost index — see `quantities.ts`. They exist so the dropdown has an answer and so a
   * product catalogue, when there is one, has something to key on.
   */
  furniture: [
    { id: 'teak-furniture', label: 'Teak', cost: 3 },
    { id: 'rattan-furniture', label: 'Rattan', cost: 2 },
    { id: 'steel-furniture', label: 'Powder-coated steel', cost: 3 },
  ],
  /*
   * A light fitting is specified by its finish, the way a timber structure is specified by its
   * timber. These three are the finishes a garden range actually comes in, and they are genuinely
   * a cost decision: solid brass is several times the price of powder-coated aluminium and is the
   * one that survives a coastal garden.
   */
  lighting: [
    { id: 'black-aluminium', label: 'Powder-coated black', cost: 2 },
    { id: 'brushed-steel', label: 'Brushed stainless steel', cost: 3 },
    { id: 'antique-brass', label: 'Solid brass', cost: 4 },
  ],
  'water-feature': [
    { id: 'naturalistic-pond', label: 'Naturalistic pond', cost: 2 },
    { id: 'formal-pool', label: 'Formal pool', cost: 4 },
    { id: 'rill', label: 'Rill', cost: 3 },
    { id: 'water-bowl', label: 'Water bowl', cost: 1 },
  ],
  /*
   * A feature carried over from step 2 keeps whatever it already was — the user said "keep this",
   * not "rebuild this". One entry, so the dropdown still renders rather than being a special case.
   */
  'existing-feature': [{ id: 'existing', label: 'Existing — unchanged', cost: 1 }],
};

/**
 * What a surface may be edged with.
 *
 * **Not in `MATERIALS`, because edging is not an `ElementCategory`.** An edging run is derived from
 * the outline of the thing it edges — see `plan/edging.ts` — so there is no element to give a
 * category to, and inventing one would mean an element the editor can select, move and delete
 * independently of the bed it belongs to, which is exactly the drift the derivation exists to
 * prevent. The list is the same `Material` shape so cost, label and lookup all work unchanged.
 *
 * Ordered cheapest-first by intent rather than by `cost`: a spade cut is what a border has unless
 * somebody pays for something, which is why `null` rather than an entry here is the default.
 */
export const EDGING_MATERIALS: Material[] = [
  { id: 'steel-edging', label: 'Steel edging', cost: 2 },
  { id: 'brick-edging', label: 'Brick soldier course', cost: 2 },
  { id: 'timber-sleeper', label: 'Timber sleeper', cost: 2 },
  { id: 'sett-edging', label: 'Granite sett course', cost: 3 },
  { id: 'concrete-kerb', label: 'Concrete kerb', cost: 3 },
];

/**
 * What a retaining wall is built of.
 *
 * Outside `MATERIALS` for the same reason `EDGING_MATERIALS` is: a retaining face is derived from
 * the edge of a raised element — see `plan/levels.ts` — so there is no element to give a category
 * to. Three, because that is how many answers there really are at garden scale: coursed stone,
 * brick, or block with a render on it.
 *
 * **Absent is a real answer and the default.** A raised terrace with no `retaining` set draws a
 * plain upstand in its own paving darkened, which is exactly what an in-situ concrete edge or a
 * terrace retained in its own stone looks like. Choosing one of these is choosing to make the wall
 * a different material from the thing it holds up.
 */
export const WALLING_MATERIALS: Material[] = [
  { id: 'walling-stone', label: 'Coursed stone walling', cost: 4 },
  { id: 'brick-walling', label: 'Brick walling', cost: 3 },
  { id: 'rendered-block', label: 'Rendered blockwork', cost: 2 },
];

export function isWallingMaterial(id: string | undefined): boolean {
  return id !== undefined && WALLING_MATERIALS.some((material) => material.id === id);
}

/** The categories a surface must be for edging to mean anything: the four that cover ground. */
export const EDGEABLE_CATEGORIES: ElementCategory[] = [
  'lawn',
  'planting-bed',
  'paved-area',
  'gravel-mulch',
];

export function canBeEdged(category: ElementCategory): boolean {
  return EDGEABLE_CATEGORIES.includes(category);
}

export function isEdgingMaterial(id: string | undefined): boolean {
  return id !== undefined && EDGING_MATERIALS.some((material) => material.id === id);
}

export function materialsFor(category: ElementCategory): Material[] {
  return MATERIALS[category];
}

export function defaultMaterial(category: ElementCategory): MaterialId {
  return MATERIALS[category][0]!.id;
}

/** Looks a material up across every category — ids are unique, so the category is not needed. */
export function findMaterial(id: string | undefined): Material | null {
  if (!id) return null;

  for (const list of Object.values(MATERIALS)) {
    const match = list.find((material) => material.id === id);
    if (match) return match;
  }

  // Edging and walling last, outside the category loop, because they belong to no category.
  return (
    EDGING_MATERIALS.find((material) => material.id === id) ??
    WALLING_MATERIALS.find((material) => material.id === id) ??
    null
  );
}

export function materialLabel(id: string | undefined): string {
  return findMaterial(id)?.label ?? 'Not specified';
}

/** Whether a material is a legal choice for a category — "no gravel lawns". */
export function canTake(category: ElementCategory, id: string): boolean {
  return MATERIALS[category].some((material) => material.id === id);
}

/** The cheaper alternative in the same category, or null when it is already the cheapest. */
export function cheaperAlternative(element: DesignElement): Material | null {
  const current = findMaterial(element.material) ?? findMaterial(defaultMaterial(element.category));
  if (!current) return null;

  const cheaper = MATERIALS[element.category]
    .filter((material) => material.cost < current.cost)
    .sort((a, b) => a.cost - b.cost);

  // The dearest of the cheaper options — a saving, not a race to the bottom.
  return cheaper.at(-1) ?? null;
}
