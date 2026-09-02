import type { ElementCategory } from './concepts.js';
import type { MaterialId } from './materials.js';

/**
 * How tall the things in a garden are.
 *
 * This exists because a shadow has a length, and that length is `height / tan(sun altitude)`.
 * Nothing in the plan document carried a height before: `DesignElement.elevation` is metres
 * *above grade* — where the top of a raised bed sits — which is a different number and cannot
 * stand in for this one. Without heights a 1.8 m fence and a 6 m tree cast identical shadows,
 * which is worse than drawing no shadow at all: it looks deliberate and it is wrong.
 *
 * **In `packages/schema` rather than in the web renderer, and that placement is the point.**
 * If heights lived next to the drawing code then the claim "these shadows show you where the
 * sun-trap is" would be made by a module `CLAUDE.md` explicitly describes as having no
 * authority, and the server could never read them — which would permanently block the placer
 * from putting seating in afternoon sun. Heights are a fact about the garden, not about how it
 * is drawn.
 *
 * Every number is a **drawing height**: what the thing presents to the sun, not a botanical
 * maximum. A shrub border is drawn at the height it is kept at, not the height it could reach
 * if nobody pruned it for twenty years.
 */

/**
 * The floor, by category. Ground surfaces are genuinely zero — paving, gravel and water sit at
 * or below grade and cast nothing, and mown grass casts nothing worth drawing at plan scale.
 *
 * `structure` is the one that cannot be answered here. A pergola is 2.4 m, a shed 2.2 m, a
 * raised bed 0.45 m, and all three can be built from `softwood` — so material tells you nothing
 * and the category default is only a placeholder until the placer sets an explicit height.
 */
export const CATEGORY_HEIGHTS: Record<ElementCategory, number> = {
  lawn: 0,
  'paved-area': 0,
  'gravel-mulch': 0,
  'water-feature': 0,
  'planting-bed': 0.9,
  structure: 2.2,
  /** Unknown by definition — it is whatever was already there. A conservative middle. */
  'existing-feature': 1,
};

/**
 * Overrides where the material genuinely implies a form, which is only true for planting.
 *
 * A hedge and a bed of ground cover are both `planting-bed`, and they are 1.8 m and 0.25 m
 * respectively — that is a seven-fold difference the category cannot express. Note the deliberate
 * absence of the structure materials: `softwood` does not imply a height, and pretending it does
 * would be inventing a number.
 */
export const MATERIAL_HEIGHTS: Partial<Record<MaterialId, number>> = {
  'ground-cover': 0.25,
  wildflower: 0.7,
  'mixed-border': 0.9,
  'ornamental-grasses': 1.1,
  shrubs: 1.3,
  hedging: 1.8,
};

/**
 * The height an element presents to the sun, resolved.
 *
 * Three tiers, most specific first: an explicit per-element height wins, then the material, then
 * the category floor. Total by construction — there is no case where a caller gets `null` and
 * has to decide what a missing height means, because "how tall is it" always has an answer even
 * if that answer is zero.
 *
 * Structurally typed rather than taking a `DesignElement`, so the generator can call it while
 * building a candidate that is not an element yet.
 */
export function heightFor(element: {
  category: ElementCategory;
  material?: string | undefined;
  height?: number | undefined;
}): number {
  if (element.height !== undefined) return element.height;

  const byMaterial = element.material
    ? MATERIAL_HEIGHTS[element.material as MaterialId]
    : undefined;

  return byMaterial ?? CATEGORY_HEIGHTS[element.category];
}

/**
 * Below this, a thing is drawn as lying on the ground and casts nothing.
 *
 * Not zero: a 40 mm kerb has a height and a shadow you could compute, but at every zoom this
 * plan supports that shadow is a fraction of a pixel. Drawing it costs a projection, a union and
 * a composite to produce nothing visible — the same reasoning `MIN_SHADED_MODULE_PX` already
 * applies to slab bevels.
 */
export const MIN_SHADOW_HEIGHT = 0.15;

/**
 * How tall the house is treated as, in metres.
 *
 * A constant rather than a manifest lookup because the house is not a `DesignElement` — it is the
 * building the garden is attached to, and the plan records its footprint, not its storeys. Six
 * metres is a two-storey eaves line, which is the shadow that matters: it is the largest single
 * shadow in most gardens and usually the reason the seating is where it is.
 *
 * Deliberately not user-editable yet. Guessing 6 m is honest — a house is roughly this tall — in
 * a way that guessing a latitude is not, because the answer varies by a metre or two rather than
 * by the entire hemisphere.
 */
export const HOUSE_HEIGHT = 6;

/**
 * Whether this element should be handed to the shadow pass at all.
 *
 * The occluder set is small on purpose — trees, hedges, the fence, the house, structures — which
 * is what makes a separate shadow layer cheap. Surfaces are flat and drop out here rather than
 * being projected to a zero-length shadow and discarded later.
 */
export function castsShadow(element: {
  category: ElementCategory;
  material?: string | undefined;
  height?: number | undefined;
}): boolean {
  return heightFor(element) >= MIN_SHADOW_HEIGHT;
}
