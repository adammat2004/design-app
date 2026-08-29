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
  'hardwood',
  'powder-coated-steel',
  // water-feature
  'naturalistic-pond',
  'formal-pool',
  'rill',
  'water-bowl',
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
    { id: 'hardwood', label: 'Hardwood', cost: 4 },
    { id: 'powder-coated-steel', label: 'Powder-coated steel', cost: 4 },
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

  return null;
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
