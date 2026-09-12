import type { ElementCategory } from './concepts.js';
import type { MaterialId } from './materials.js';
import { DEFAULT_STOREYS } from './site.js';
import { resolveSymbol, SYMBOLS } from './symbols.js';

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
  /** Table height. A symbol nearly always says more — see `SYMBOLS` — and wins when it does. */
  furniture: 0.75,
  /*
   * A spike light, which is the commonest fitting and the middle of the four. Every light carries
   * a symbol in practice and the symbol wins, so this is only the answer for a fitting placed with
   * none — and it is deliberately above `MIN_SHADOW_HEIGHT` rather than below it, because a light
   * that silently stopped casting would be indistinguishable from one that failed to draw.
   */
  lighting: 0.3,
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
  symbol?: string | undefined;
}): number {
  if (element.height !== undefined) return element.height;

  /*
   * The symbol sits between the explicit height and the material: a pergola and a raised bed are
   * both softwood structures at 2.4 m and 0.45 m, and the material cannot tell them apart where
   * the symbol can. Still below an explicit height, which the placer sets when it knows better.
   */
  const symbol = resolveSymbol(element);
  if (symbol) return SYMBOLS[symbol].height;

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
 * The eaves line for a house of so many storeys, in metres.
 *
 * A table rather than `storeys × STOREY_HEIGHT` because a house is not a stack of rooms: a
 * bungalow's eaves sit at about three metres, a two-storey house at six, and a third floor adds
 * less than the second because it is often in the roof. Six for two storeys is the value every
 * plan drew with before `storeys` existed, so the default changes nothing.
 */
export const EAVES_BY_STOREYS: Record<1 | 2 | 3, number> = { 1: 3, 2: 6, 3: 8.7 };

/**
 * How tall the house is treated as, in metres.
 *
 * The house is not a `DesignElement`, so its height does not come from the manifest: it comes
 * from the one vertical fact the plan records about the building, `HouseFootprint.storeys`. That
 * is the shadow that matters — the largest single shadow in most gardens and usually the reason
 * the seating is where it is.
 *
 * Tolerates an absent `storeys` for the reason `patternAnchor` and `scatterForm` do: fixtures and
 * hand-built houses never go through `.parse()`, so a Zod default alone would look applied and
 * never fire.
 */
export function houseHeight(house: { storeys?: number | undefined } | null | undefined): number {
  const storeys = house?.storeys ?? DEFAULT_STOREYS;
  return EAVES_BY_STOREYS[Math.min(3, Math.max(1, Math.round(storeys))) as 1 | 2 | 3];
}

/**
 * The two-storey eaves line, kept for callers that have no house to ask — the property symbols
 * and the roof both say why six metres is an honest guess where a latitude would not be.
 */
export const HOUSE_HEIGHT = EAVES_BY_STOREYS[DEFAULT_STOREYS as 2];

/**
 * Whether this element should be handed to the shadow pass at all.
 *
 * The occluder set is small on purpose — trees, hedges, the fence, the house, structures — which
 * is what makes a separate shadow layer cheap. Surfaces are flat and drop out here rather than
 * being projected to a zero-length shadow and discarded later.
 *
 * **`elevation` counts towards that, and leaving it out was a real bug.** A terrace is flat, so
 * `heightFor` is 0 and it dropped out here — which meant a terrace raised 340 mm was filtered away
 * before anything downstream could give it the plinth it stands on, and the raised edge cast
 * nothing at all. A raised surface is a wall as far as the sun is concerned, whatever it is in
 * itself. Negative elevations are excluded for the reason `shadowOccluders` gives: a sunken area
 * is shaded by ground this model does not have.
 */
export function castsShadow(element: {
  category: ElementCategory;
  material?: string | undefined;
  height?: number | undefined;
  elevation?: number | undefined;
}): boolean {
  return heightFor(element) + Math.max(0, element.elevation ?? 0) >= MIN_SHADOW_HEIGHT;
}
