import {
  canTake,
  defaultMaterial,
  DESIRED_FEATURE_LABELS,
  MATERIALS,
  STYLE_LABELS,
  type BudgetBand,
  type DesiredFeature,
  type ElementCategory,
  type GardenBrief,
  type MaintenanceLevel,
  type MaterialId,
  type Point,
  type PlanGeometry,
  type ZoneId,
} from '@garden-studio/schema';
import type { DesignConstraints } from './constraints.js';
import { TEMPLATE_NAMES } from './layout/templates/index.js';
import type { TemplateId } from './layout/sketch.js';

/**
 * Generator *policy*: what the brief's answers become on the ground, and how the three concepts
 * differ from each other.
 *
 * Deliberately not in `@garden-studio/schema`. Only the server generates, and the shape of a
 * concept is a shared contract in a way that "a dining area is 5.2 x 3.8 m and wants to be near
 * the house" is not — that is an opinion, and it belongs where the opinion is acted on.
 */

export interface FeatureSpec {
  category: ElementCategory;
  /** Rect footprint in metres, or a radius for the round ones. */
  footprint: { kind: 'rect'; width: number; depth: number } | { kind: 'point'; radius: number };
  prefer: ZoneId[];
  affinity: 'near-house' | 'far-from-house' | 'any';
  /** Overrides the brief label on the plan, where the catalogue wording is too long. */
  planName?: string;
  /**
   * A material the feature always has, whatever the palette says. Play bark is the ground of a
   * play area and nothing else: it used to come from `materialFor('gravel-mulch')` whenever the
   * brief asked for play, which made it the base of the front garden and the gravel panel of a
   * low-maintenance concept too.
   */
  material?: MaterialId;
}

/**
 * `affinity` is the only piece of intent in the whole generator: a dining area wants to be near
 * the house, a shed wants to be out of the way. It costs one distance comparison and it is the
 * difference between a plan that reads as designed and one that reads as scattered.
 */
export const FEATURE_SPECS: Record<DesiredFeature, FeatureSpec> = {
  seating: {
    category: 'paved-area',
    footprint: { kind: 'rect', width: 5.2, depth: 3.8 },
    prefer: ['back', 'front'],
    affinity: 'near-house',
    planName: 'Seating patio',
  },
  play: {
    category: 'gravel-mulch',
    footprint: { kind: 'rect', width: 4.2, depth: 4 },
    prefer: ['back', 'left', 'right'],
    affinity: 'far-from-house',
    planName: 'Play area',
    material: 'play-bark',
  },
  vegPatch: {
    category: 'planting-bed',
    footprint: { kind: 'rect', width: 4, depth: 2.5 },
    prefer: ['back', 'right', 'left'],
    affinity: 'far-from-house',
    planName: 'Veg beds',
  },
  water: {
    category: 'water-feature',
    footprint: { kind: 'point', radius: 0.9 },
    prefer: ['back', 'front'],
    affinity: 'any',
    planName: 'Water feature',
  },
  pergola: {
    category: 'structure',
    footprint: { kind: 'rect', width: 3.6, depth: 3.6 },
    prefer: ['back'],
    affinity: 'near-house',
    planName: 'Dining pergola',
  },
  firePit: {
    category: 'gravel-mulch',
    footprint: { kind: 'point', radius: 2 },
    prefer: ['back', 'left', 'right'],
    affinity: 'far-from-house',
    planName: 'Fire pit',
    material: 'decorative-gravel',
  },
  storage: {
    category: 'structure',
    footprint: { kind: 'rect', width: 2.5, depth: 2 },
    prefer: ['left', 'right', 'back'],
    affinity: 'far-from-house',
    planName: 'Garden store',
  },
  outdoorKitchen: {
    category: 'structure',
    footprint: { kind: 'rect', width: 3, depth: 1.4 },
    prefer: ['back'],
    affinity: 'near-house',
    planName: 'Outdoor kitchen',
  },
  /*
   * Somewhere to eat, as opposed to somewhere to sit. It used to be the same answer as `seating`
   * — the label was "Seating / dining area" — and folding the two together meant a brief asking
   * for both got one patio with a sofa on it. They are different rooms with different furniture
   * and, in a real garden, usually different places: the table near the kitchen door, the sofas
   * where the evening sun lands.
   *
   * Sized off `FURNISHINGS.dining` through `hostFloor`, so it is the table that decides the floor.
   */
  dining: {
    category: 'paved-area',
    footprint: { kind: 'rect', width: 4.6, depth: 3.4 },
    prefer: ['back', 'front'],
    affinity: 'near-house',
    planName: 'Dining terrace',
  },
  hotTub: {
    category: 'structure',
    footprint: { kind: 'rect', width: 2.4, depth: 2.4 },
    prefer: ['back'],
    affinity: 'near-house',
    planName: 'Hot tub',
  },
  /*
   * A garden room is a building you walk to, so it is `far-from-house` — put against the back
   * wall it is an extension, which is a different project with a different planning answer.
   */
  gardenRoom: {
    category: 'structure',
    footprint: { kind: 'rect', width: 4, depth: 3 },
    prefer: ['back', 'left', 'right'],
    affinity: 'far-from-house',
    planName: 'Garden room',
  },
  greenhouse: {
    category: 'structure',
    footprint: { kind: 'rect', width: 3, depth: 2.4 },
    prefer: ['back', 'right', 'left'],
    affinity: 'far-from-house',
    planName: 'Greenhouse',
  },
  /*
   * ---- the three composed answers ----
   *
   * A lawn, a border and a lighting scheme are things the plan already draws: the template lays a
   * lawn panel, `designedBeds` cuts the borders, `lightingScheme` composes from what was placed.
   * Asking for one of them therefore *steers* that pass rather than dropping a second copy on top
   * of it — `concepts.service.ts` settles all three from what actually landed, and never sends
   * them through `assignSlots` or the sampler.
   *
   * They still need a spec, because `FEATURE_SPECS` is total and because the sampler is the whole
   * placer on a plot with no house to compose a room off. These footprints are what that fallback
   * would drop, and nothing else reads them.
   */
  lawn: {
    category: 'lawn',
    footprint: { kind: 'rect', width: 6, depth: 5 },
    prefer: ['back'],
    affinity: 'far-from-house',
    planName: 'Lawn',
  },
  plantingBeds: {
    category: 'planting-bed',
    footprint: { kind: 'rect', width: 4, depth: 1.5 },
    prefer: ['back', 'left', 'right'],
    affinity: 'any',
    planName: 'Planting bed',
  },
  lighting: {
    category: 'lighting',
    footprint: { kind: 'point', radius: 0.1 },
    prefer: ['back', 'front', 'left', 'right'],
    affinity: 'any',
    planName: 'Garden lighting',
  },
  other: {
    category: 'paved-area',
    footprint: { kind: 'rect', width: 2.5, depth: 2.5 },
    prefer: ['back', 'front', 'left', 'right'],
    affinity: 'any',
  },
};

/**
 * Which features a large plot may have two of.
 *
 * A second seating area on an estate is ordinary — a terrace by the house and somewhere to sit at
 * the far end. A second shed is a mistake, and a second outdoor kitchen is absurd. The distinction
 * is a judgement about gardens rather than about geometry, which is why it is a list here beside
 * the other opinions rather than a rule derived from the footprint.
 */
/*
 * Note `plantingBeds` is deliberately absent despite being the most repeatable thing in a garden:
 * it is composed rather than placed, so it never reaches the surplus pass at all, and listing it
 * here would be a line that reads as policy and does nothing. The borders already grow with the
 * plot because `designedBeds` cuts them from the room.
 */
export const REPEATABLE_FEATURES: DesiredFeature[] = ['seating', 'dining', 'vegPatch', 'water'];

/** The footprint's shortest half-extent — how far a centre must sit from the free region's edge. */
export function inradius(spec: FeatureSpec): number {
  return spec.footprint.kind === 'point'
    ? spec.footprint.radius
    : Math.min(spec.footprint.width, spec.footprint.depth) / 2;
}

export function geometryAt(spec: FeatureSpec, at: Point, rotation: number): PlanGeometry {
  if (spec.footprint.kind === 'point') {
    return { kind: 'point', at, radius: spec.footprint.radius };
  }

  return {
    kind: 'rect',
    centre: at,
    width: spec.footprint.width,
    depth: spec.footprint.depth,
    rotation,
  };
}

/* ---------------------------------------------------------------- concept character */

const BUDGET_ORDER: BudgetBand[] = ['low', 'medium', 'high', 'premium'];

export function shiftBudget(band: BudgetBand, by: number): BudgetBand {
  const index = BUDGET_ORDER.indexOf(band);
  return BUDGET_ORDER[Math.min(BUDGET_ORDER.length - 1, Math.max(0, index + by))]!;
}

export interface Archetype {
  key: string;
  recommended: boolean;
  budgetShift: number;
  maintenance: (brief: GardenBrief) => MaintenanceLevel;
  /** How much of the requested list this concept even attempts. */
  ambition: number;
  accentCount: number;
}

/**
 * The three concepts are not three rolls of the same dice — they are three positions on the same
 * brief, which is what makes a comparison screen worth having. The first answers the brief as
 * written and is the recommendation; the other two push in opposite directions.
 */
export const ARCHETYPES: Archetype[] = [
  {
    key: 'balanced',
    recommended: true,
    budgetShift: 0,
    maintenance: (brief) => brief.maintenance ?? 'medium',
    ambition: 1,
    accentCount: 2,
  },
  {
    key: 'entertaining',
    recommended: false,
    budgetShift: 1,
    maintenance: () => 'medium',
    ambition: 1,
    accentCount: 3,
  },
  {
    key: 'retreat',
    recommended: false,
    budgetShift: -1,
    maintenance: () => 'low',
    // A calmer plan on purpose: fewer built things, more ground cover.
    ambition: 0.7,
    accentCount: 1,
  },
];

export const CONCEPTS_PER_SET = ARCHETYPES.length;

/**
 * Which archetype a concept slot carries, given which slot is the recommendation.
 *
 * The three slots are the three layout templates, in a fixed order. The recommended slot takes
 * the balanced archetype — it answers the brief as written — and the other two take the
 * entertaining and retreat positions in slot order, so a cottage brief's recommendation is still
 * budget-neutral and the alternatives still lean one way each.
 */
export function archetypeFor(index: number, recommendedIndex: number): Archetype {
  if (index === recommendedIndex) return ARCHETYPES[0]!;
  const others = [0, 1, 2].filter((slot) => slot !== recommendedIndex);
  const position = Math.max(0, others.indexOf(index % 3));
  return ARCHETYPES[1 + position] ?? ARCHETYPES[1]!;
}

/* ---------------------------------------------------------------- furnishing */

// The furnishing tables live in a leaf module (`furnishings.ts`) because the sketch layer derives
// the terrace floor from them, and this file imports the template registry that the sketch layer
// is part of. Re-exported here for the callers that always found them here.
export { FURNISHINGS, HOST_SYMBOLS } from './furnishings.js';

/**
 * The default surface a concept falls back to, and what it accents with.
 *
 * One rule per concept, applied to every region in it — not a roll per element. A plan whose
 * ground cover changed at random from patch to patch would look like a fault rather than a
 * decision, and would make the three concepts indistinguishable from each other.
 */
export function fillPalette(
  constraints: DesignConstraints,
  index: number,
): { base: ElementCategory; accents: ElementCategory[] } {
  const lowUpkeep = constraints.maintenance === 'low' || constraints.style === 'lowMaintenance';

  const preferred: ElementCategory[] = lowUpkeep
    ? ['gravel-mulch', 'planting-bed', 'lawn']
    : ['lawn', 'planting-bed', 'lawn'];

  const accents: Record<ElementCategory, ElementCategory[]> = {
    lawn: ['planting-bed', 'gravel-mulch'],
    'planting-bed': ['lawn', 'gravel-mulch'],
    'gravel-mulch': ['planting-bed', 'lawn'],
    'paved-area': ['lawn', 'planting-bed'],
    structure: ['lawn', 'planting-bed'],
    'water-feature': ['lawn', 'planting-bed'],
    furniture: ['lawn', 'planting-bed'],
    lighting: ['lawn', 'planting-bed'],
    'existing-feature': ['lawn', 'planting-bed'],
  };

  /*
   * The forbidden list is applied to the *result*, not folded into the tables above.
   *
   * It has to be, and this is the second half of the observed defect: even when the badge and the
   * palette agreed, a `gravel-mulch` base took `['planting-bed', 'lawn']` as its accents, so lawn
   * came back as an accent on a low-maintenance concept regardless. Filtering once, here, is what
   * makes "no lawn" true of the whole palette rather than of the base only.
   */
  const allowed = (category: ElementCategory) => !constraints.forbiddenFill.includes(category);

  // `planting-bed` is the backstop on both lines: it is the one ground cover nothing forbids, and
  // a concept with no legal fill at all would generate a garden of bare graph paper.
  const bases = preferred.filter(allowed);
  const base = bases.length > 0 ? bases[index % bases.length]! : 'planting-bed';

  const chosen = accents[base].filter(allowed);

  return { base, accents: chosen.length > 0 ? chosen : ['planting-bed'] };
}

/**
 * What each surface is actually made of.
 *
 * The generator used to leave `material` unset and let the client fall back to a category colour,
 * which had two costs: step 4's concept cards drew flat where step 5 drew textured, and a concept
 * could not express the difference between a porcelain terrace and a poured-concrete one — a real
 * design decision the brief already carries the information to make.
 *
 * Choices are policy, so they live here beside the archetypes rather than in the shared catalogue.
 * `canTake` is the guard: a material that is not legal for its category is a bug, and the caller
 * falls back to the category default rather than drawing something the dropdown would refuse.
 */
export function materialFor(
  category: ElementCategory,
  constraints: DesignConstraints,
  index: number,
): MaterialId {
  const dear = constraints.budget === 'high' || constraints.budget === 'premium';
  const lowUpkeep = constraints.maintenance === 'low' || constraints.style === 'lowMaintenance';
  const formal = constraints.style === 'formal' || constraints.style === 'modern';

  const chosen = ((): MaterialId => {
    switch (category) {
      /*
       * The lawn is the mown panel, so it is turf whatever the style. A cottage garden used to get
       * `wildflower` here, which drew the one panel meant to be walked on as a meadow; the meadow
       * belongs in the borders, where the cottage planting branch below offers it.
       */
      case 'lawn':
        if (lowUpkeep && constraints.wantsPlay) return 'artificial-turf';
        return constraints.wantsPlay ? 'hardwearing-turf' : 'standard-turf';

      case 'paved-area':
        if (dear) return formal ? 'porcelain' : 'stone-pavers';
        return (['concrete', 'stone-pavers', 'concrete'] as const)[index % 3]!;

      /*
       * Hedging is deliberately never the first choice. It is the densest thing the renderer
       * draws, and an accent bed can be most of a zone — sixty square metres of it reads as a
       * thicket rather than as a garden. As one of three it is a clipped structural block, which
       * is what hedging is for.
       */
      case 'planting-bed':
        if (formal) return (['shrubs', 'mixed-border', 'hedging'] as const)[index % 3]!;
        if (lowUpkeep)
          return (['shrubs', 'ground-cover', 'ornamental-grasses'] as const)[index % 3]!;
        if (constraints.style === 'cottage')
          return (['mixed-border', 'wildflower', 'shrubs'] as const)[index % 3]!;
        return (['mixed-border', 'ornamental-grasses', 'shrubs'] as const)[index % 3]!;

      case 'gravel-mulch':
        return formal
          ? 'slate-chippings'
          : (['decorative-gravel', 'bark-mulch'] as const)[index % 2]!;

      case 'structure':
        return dear ? 'hardwood' : (['softwood', 'painted-timber'] as const)[index % 2]!;

      case 'water-feature':
        return formal ? 'formal-pool' : 'naturalistic-pond';

      case 'furniture':
        if (dear) return 'teak-furniture';
        return formal ? 'steel-furniture' : 'rattan-furniture';

      /*
       * Finish follows the same two axes every other category does, and brass is deliberately the
       * dear answer rather than the formal one: solid brass is the fitting that survives, and it
       * suits a cottage garden weathering to bronze quite as much as a modern one.
       */
      case 'lighting':
        if (dear) return 'antique-brass';
        return formal ? 'brushed-steel' : 'black-aluminium';

      case 'existing-feature':
        return 'existing';
    }
  })();

  /*
   * Two guards, in order. `forbiddenMaterials` catches the case the switch above cannot: a brief
   * that is both `formal` and low-maintenance takes the formal branch and lands on `mixed-border`,
   * which is exactly the flowering perennial bed a low-maintenance concept must not contain.
   * `canTake` then catches a material that is not legal for its category at all, which would be a
   * bug rather than a preference.
   */
  const permitted = constraints.forbiddenMaterials.includes(chosen)
    ? (MATERIALS[category].find((material) => !constraints.forbiddenMaterials.includes(material.id))
        ?.id ?? defaultMaterial(category))
    : chosen;

  return canTake(category, permitted) ? permitted : defaultMaterial(category);
}

/**
 * What a concept edges its beds with, or `null` for the spade cut every border has for free.
 *
 * **Restraint is the design here.** Edging is a real cost by the metre and a real visual weight,
 * and a garden with a hard course round every bed reads as a municipal planting scheme rather than
 * a garden. So it is offered only where a style actually calls for it:
 *
 * - **formal** wants the line — a clipped, defined edge is most of what makes a formal garden read
 *   as one — and takes setts, or brick where the budget is modest.
 * - **cottage** takes brick, which is the traditional answer and the one that suits the planting
 *   falling over it.
 * - **modern** takes steel, which is the whole point of steel edging: a line with no width.
 * - **low maintenance** takes steel too, because that is what it is *for* — the edge that keeps
 *   the gravel in and never needs recutting.
 * - everything else gets nothing, which is the commonest answer and the right one.
 *
 * Never on a low budget, for the same reason lighting is not: a concept that quietly specified
 * ninety metres of granite would be misreporting what it costs to build.
 */
export function edgingFor(constraints: DesignConstraints): MaterialId | null {
  if (constraints.budget === 'low') return null;

  const dear = constraints.budget === 'high' || constraints.budget === 'premium';
  const lowUpkeep = constraints.maintenance === 'low' || constraints.style === 'lowMaintenance';

  if (constraints.style === 'formal') return dear ? 'sett-edging' : 'brick-edging';
  if (constraints.style === 'cottage') return 'brick-edging';
  if (constraints.style === 'modern' || lowUpkeep) return 'steel-edging';

  return null;
}

/**
 * A feature spec resized for the plot it is going on.
 *
 * `FEATURE_SPECS` stays quoted at suburban scale so the manifest still reads as "a dining pergola
 * is 3.6 x 3.6 m", and the scaling happens at the point of use. Doing it the other way round —
 * storing pre-scaled footprints — would make the numbers in that table mean nothing on their own.
 */
export function scaledSpec(spec: FeatureSpec, constraints: DesignConstraints): FeatureSpec {
  const factor = constraints.scale.sizeFactor;
  if (Math.abs(factor - 1) < 1e-9) return spec;

  return {
    ...spec,
    footprint:
      spec.footprint.kind === 'point'
        ? { kind: 'point', radius: spec.footprint.radius * factor }
        : {
            kind: 'rect',
            width: spec.footprint.width * factor,
            depth: spec.footprint.depth * factor,
          },
  };
}

/**
 * What the concept card calls the style.
 *
 * `STYLE_LABELS` is one word per direction now, so this is a straight lookup — it used to take the
 * first half of "Modern / minimal" with a `split`, which would silently return the whole label the
 * day somebody reworded one.
 */
export function styleLabel(brief: GardenBrief): string {
  if (brief.style === 'other') return brief.styleOther.trim() || 'Bespoke';
  if (!brief.style) return 'Contemporary';

  return STYLE_LABELS[brief.style];
}

export function featureLabel(feature: DesiredFeature, brief: GardenBrief): string {
  if (feature === 'other') return brief.featuresOther.trim() || DESIRED_FEATURE_LABELS.other;
  return DESIRED_FEATURE_LABELS[feature];
}

export function describeConcept(
  template: TemplateId,
  brief: GardenBrief,
): { name: string; summary: string; style: string } {
  const names = TEMPLATE_NAMES[template];
  return {
    name: names.name,
    summary: names.summary,
    style: `${styleLabel(brief)} / ${names.tone}`,
  };
}
