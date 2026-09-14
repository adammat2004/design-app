import {
  type BudgetBand,
  type ElementCategory,
  type GardenBrief,
  type MaintenanceLevel,
  type MaterialId,
  type PlantingStyle,
  type SymbolId,
} from '@garden-studio/schema';
import type { Archetype } from './archetypes.js';

/**
 * What the brief actually forbids, and how big the plot is, resolved once.
 *
 * This layer exists because of a specific defect: a concept badged **Maintenance: Low** contained a
 * lawn and mixed flowering perennial beds. The cause was not a bad rule, it was two sources for one
 * decision — `concepts.service` stamped the card with `archetype.maintenance(brief)` while
 * `fillPalette` read `brief.maintenance`, so the badge and the ground cover were computed
 * independently and a brief saying "medium" produced a card saying "low" with a lawn under it.
 *
 * Resolving both from one call is the fix, and it is structural rather than a patch: after this
 * there is no second source left to diverge from. Everything downstream reads `DesignConstraints`
 * and nothing downstream reads the brief.
 *
 * It also belongs here rather than in the prompt, for the same reason coordinates do. "Low
 * maintenance means no lawn" is a rule that can be *checked*; asking a model to remember it is
 * asking for it to be true most of the time.
 */

export type PlotScaleBand = 'courtyard' | 'suburban' | 'large' | 'estate';

/** Designed area, in square metres, at the top of each band. */
const BAND_LIMITS: { band: PlotScaleBand; upTo: number }[] = [
  { band: 'courtyard', upTo: 60 },
  { band: 'suburban', upTo: 400 },
  { band: 'large', upTo: 1500 },
  { band: 'estate', upTo: Infinity },
];

/**
 * The designed area a suburban back garden comes to, and the size at which `FEATURE_SPECS` is
 * quoted. A 5.2 x 3.8 m dining area is the right size on *this* plot; everything else is scaled
 * from it.
 */
export const SUBURBAN_REFERENCE = 150;

/**
 * How hard feature footprints follow the plot, as an exponent on the area ratio.
 *
 * Sub-linear on purpose, and this is the whole trick. A plot ten times larger does not want a
 * dining area ten times larger — it wants *more* areas and a somewhat larger one. Linear scaling
 * produces a 130 m² pergola; no scaling at all produces the observed defect, a 13 m² pergola
 * marooned on 8,400 m². At 0.35 a ten-fold plot gives roughly a two-fold footprint, which is about
 * what a landscaper would actually draw.
 */
const SIZE_EXPONENT = 0.35;

/** Clamped, so neither a window box nor a farm can push the footprints somewhere absurd. */
const MIN_SIZE_FACTOR = 0.6;
const MAX_SIZE_FACTOR = 2.5;

/** How much of the requested list each band even attempts. */
const BAND_AMBITION: Record<PlotScaleBand, number> = {
  courtyard: 0.7,
  suburban: 1,
  large: 1.4,
  estate: 1.8,
};

export interface PlotScale {
  band: PlotScaleBand;
  /** Square metres actually in scope — the zones the user ticked, not the whole plot. */
  designedArea: number;
  /** Multiplier applied to every `FEATURE_SPECS` footprint. */
  sizeFactor: number;
}

export interface DesignConstraints {
  /**
   * The concept's own declared position, and **the single source for both the badge and the
   * palette**. Read `constraints.maintenance` everywhere; never `brief.maintenance` again.
   */
  maintenance: MaintenanceLevel;
  budget: BudgetBand;
  /** Ground cover this concept may not use, as a base or as an accent. */
  forbiddenFill: ElementCategory[];
  /** Materials ruled out by upkeep, independently of what the budget could afford. */
  forbiddenMaterials: MaterialId[];
  /** Kept so material choice can still read the style; nothing else may. */
  style: GardenBrief['style'];
  wantsPlay: boolean;
  /**
   * The brief asked for a lawn by name, which is the one thing that overrides the low-upkeep ban
   * on one. Kept as its own flag rather than left implicit in `forbiddenFill`, because the two say
   * different things: the list is what this concept may not draw, and this is why.
   */
  wantsLawn: boolean;
  /** The brief asked for lighting by name, which is what lifts `lightingScheme`'s budget gate. */
  wantsLighting: boolean;
  scale: PlotScale;
  /**
   * How every bed this concept places is planted — see `planting.ts` in the shared package.
   *
   * Resolved here rather than at the point of use, for the reason everything else in this record
   * is: the badge and the palette drifted apart once because two call sites each read the brief for
   * themselves, and the planting style is the same kind of decision. One answer, read by everyone.
   *
   * It follows the **capped** maintenance rather than the brief's own style where the two conflict,
   * because a low-upkeep concept cannot be planted as a cottage border however the brief was
   * worded — the whole point of a cottage border is that somebody cuts it back twice a year.
   */
  plantingStyle: PlantingStyle;
}

/** Ascending upkeep, so "no more than the brief asked for" is a comparison. */
const MAINTENANCE_ORDER: MaintenanceLevel[] = ['low', 'medium', 'high'];

/**
 * A stated maintenance level is a **ceiling**, not a suggestion.
 *
 * The three archetypes exist to be three positions on one brief, and two of them declare their own
 * upkeep — the entertaining concept is `medium` whatever was asked. Left unchecked that means a
 * user who said "low maintenance" is offered a medium-upkeep concept among the three, which is the
 * same defect this layer exists to fix wearing a different hat: the brief having no force.
 *
 * Capping rather than overriding, because an archetype is still free to come in *under* the
 * ceiling. The retreat stays low on a medium brief — less work than asked for is never the
 * complaint — and the three concepts still differ, on budget and on what they emphasise.
 */
function cappedMaintenance(
  proposed: MaintenanceLevel,
  ceiling: MaintenanceLevel | null,
): MaintenanceLevel {
  if (!ceiling) return proposed;

  return MAINTENANCE_ORDER.indexOf(proposed) <= MAINTENANCE_ORDER.indexOf(ceiling)
    ? proposed
    : ceiling;
}

export function resolvePlotScale(designedArea: number): PlotScale {
  const area = Math.max(0, designedArea);
  const band = BAND_LIMITS.find((entry) => area <= entry.upTo)!.band;
  const ratio = area > 0 ? area / SUBURBAN_REFERENCE : 1;

  return {
    band,
    designedArea: area,
    sizeFactor: clamp(ratio ** SIZE_EXPONENT, MIN_SIZE_FACTOR, MAX_SIZE_FACTOR),
  };
}

/**
 * The rules for one concept, from the brief it answers and the position its archetype takes on it.
 *
 * `maintenance` comes from the archetype rather than the brief because that is what the card
 * claims — archetype 2 is the low-maintenance retreat whatever the brief said — and the whole point
 * of this function is that the claim and the design come from the same place.
 */
export function resolveConstraints(
  brief: GardenBrief,
  archetype: Archetype,
  designedArea: number,
): DesignConstraints {
  const maintenance = cappedMaintenance(archetype.maintenance(brief), brief.maintenance);
  const budget = brief.budget ?? 'medium';
  const lowUpkeep = maintenance === 'low' || brief.style === 'lowMaintenance';
  /*
   * A lawn asked for **by name**, which is a different kind of answer from a maintenance slider.
   *
   * The two can now genuinely disagree: `lowMaintenance` reads as "Minimalist" on the style cards,
   * so picking a minimalist look and a lawn in the same brief is an ordinary thing to do rather
   * than a contradiction. Where they conflict the named thing wins — the user pointed at a picture
   * of a lawn, and silently returning a garden without one is the failure mode this whole layer
   * exists to prevent. The upkeep claim on the card still comes from `maintenance`, so the concept
   * says what it is.
   */
  const wantsLawn = brief.desiredFeatures.includes('lawn');

  return {
    maintenance,
    budget,
    /*
     * A lawn is the single largest upkeep commitment in a small garden — mown weekly through the
     * season — so "low maintenance" has to mean it is not there. It is forbidden outright rather
     * than capped as a fraction because a *little* lawn still needs the mower.
     */
    forbiddenFill: lowUpkeep && !wantsLawn ? ['lawn'] : [],
    /*
     * The flowering perennial mixes, and only those. `shrubs`, `ground-cover`, `ornamental-grasses`
     * and `hedging` all stay: they are genuinely low-upkeep, and removing them would leave a
     * low-maintenance concept with nothing to plant with.
     */
    forbiddenMaterials: lowUpkeep ? ['mixed-border', 'wildflower'] : [],
    style: brief.style,
    plantingStyle: resolvePlantingStyle(brief.style, maintenance),
    wantsPlay: brief.desiredFeatures.includes('play'),
    wantsLawn,
    /*
     * Lighting is a real cost with a real trench in it, which is why `lightingScheme` draws none
     * at a low budget. A user who ticked it has said they will pay for it, and that is the only
     * thing that lifts the gate.
     */
    wantsLighting: brief.desiredFeatures.includes('lighting'),
    scale: resolvePlotScale(designedArea),
  };
}

/**
 * How many of the requested features to attempt.
 *
 * Three terms: the archetype's own appetite, the plot's band, and the budget. A courtyard cannot
 * hold six things whatever the brief says, and an estate that gets only six is the defect this is
 * here to fix — the answer to a bigger plot is more garden, not the same garden spread thinner.
 */
export function featureAttempts(
  requestedCount: number,
  archetype: Archetype,
  constraints: DesignConstraints,
): number {
  const budgetTerm = constraints.budget === 'low' ? -1 : constraints.budget === 'premium' ? 1 : 0;
  const scaled = requestedCount * archetype.ambition * BAND_AMBITION[constraints.scale.band];

  return Math.max(0, Math.round(scaled) + budgetTerm);
}

/* ---------------------------------------------------------------- indicative cost */

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The planting style for a concept.
 *
 * Upkeep wins over taste where they disagree, and that ordering is the point: a bed planted as a
 * cottage border needs cutting back, staking and dividing, so promising one to somebody who asked
 * for low maintenance is a design that fails in its second year. `low-maintenance` is what a capped
 * low concept gets whatever the brief's style said — the same "a stated maintenance level is a
 * ceiling" rule `cappedMaintenance` applies to the badge.
 *
 * Everything else maps taste to planting: modern gardens are planted in repeated blocks, formal
 * ones on structure and clipped form, cottage gardens densely and mixed. An unstated style gets
 * `naturalistic`, because drifts read as deliberate whatever the garden turns out to be, where a
 * wrong strong style reads as a mistake.
 */
export function resolvePlantingStyle(
  style: GardenBrief['style'],
  maintenance: MaintenanceLevel,
): PlantingStyle {
  if (maintenance === 'low') return 'low-maintenance';

  switch (style) {
    case 'modern':
      return 'contemporary';
    case 'cottage':
      return 'cottage';
    case 'formal':
      return 'architectural';
    case 'lowMaintenance':
      return 'low-maintenance';
    default:
      return 'naturalistic';
  }
}

/**
 * Which trees a garden of this style is planted with, in the order they are placed.
 *
 * A list rather than one species, because a garden with five identical trees is as unconvincing as
 * one with five random ones. Cycling a short ordered list gives a garden two or three kinds of tree
 * that go together — which is what a designer would specify — and keeps it deterministic, so the
 * same brief and seed draw the same garden.
 *
 * The lists are claims about the style. A formal garden leans on evergreen structure; a cottage
 * garden on blossom and fruit; a modern one on a few clean deciduous canopies. `naturalistic` is
 * the fallback and mixes native-feeling broadleaf with multi-stem, which reads as a garden that
 * grew rather than one that was bought.
 */
const TREE_PALETTES: Record<string, SymbolId[]> = {
  modern: ['tree-deciduous', 'tree-multistem', 'tree-evergreen'],
  cottage: ['tree-fruit', 'tree-ornamental', 'tree-deciduous'],
  formal: ['tree-evergreen', 'tree-ornamental'],
  lowMaintenance: ['tree-evergreen', 'tree-deciduous'],
};

const DEFAULT_TREE_PALETTE: SymbolId[] = ['tree-deciduous', 'tree-multistem', 'tree-ornamental'];

/**
 * The species for the nth tree in a concept.
 *
 * Indexed rather than sampled, so a plan regenerated from the same seed plants the same trees — and
 * so the first tree, which is usually the specimen in the middle of the lawn, is the same one every
 * time rather than whatever the RNG happened to reach.
 */
export function treeSpeciesFor(style: GardenBrief['style'], index: number): SymbolId {
  const palette = (style && TREE_PALETTES[style]) || DEFAULT_TREE_PALETTE;
  return palette[index % palette.length]!;
}

/**
 * How rounded an accent bed's corners are, by style.
 *
 * A cottage garden has sinuous beds and a lawn that curves round them; a modern or formal one has
 * crisp edges; a low-maintenance one sits between, because a gentle curve is easier to mow round
 * than a tight one and easier to edge than a straight run against paving. Real geometry, not a
 * drawing choice: `roundPolygon` tessellates the radius for the canvas and the validator alike.
 */
export function styleCornerRadius(style: GardenBrief['style']): number {
  switch (style) {
    case 'cottage':
      return 1.2;
    case 'lowMaintenance':
      return 0.5;
    case 'modern':
    case 'formal':
      return 0;
    default:
      return 0.5;
  }
}
