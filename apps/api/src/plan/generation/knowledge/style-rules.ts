import type {
  CirculationStyle,
  GardenBrief,
  LayoutArchetypeId,
  StyleDirection,
} from '@garden-studio/schema';

/**
 * What a style means for the *shape* of a plan, as opposed to what it is made of.
 *
 * Style has been a material decision for this project's whole life: `materialFor`, `edgingFor`,
 * `resolvePlantingStyle`, `styleCornerRadius` and the tree palettes all branch on it, and between
 * them they decide what a garden is paved and planted with. What none of them decides is how it is
 * *composed*, and the result is that "modern" and "natural" differ in colour and corner radius
 * while the geometry underneath is the same terrace, the same lawn and the same far corner.
 *
 * A real style difference is structural. Modern means fewer, larger surfaces, everything aligned to
 * one grid and a short material list. Naturalistic means curves, larger masses of planting and a
 * route that does not show you the whole garden at once. Traditional means symmetry where the plot
 * allows it and a lawn with a defined edge.
 *
 * **This table is read by the evaluator and the archetype selector, never by the painters.** The
 * material half stays where it is — one source per decision — and nothing here changes a hex.
 */

export interface StyleRules {
  /**
   * Whether the plan should be mirrored about the door axis. `required` is scored: a formal plan
   * that is not symmetric has lost most of what makes it formal.
   */
  symmetry: 'required' | 'preferred' | 'avoid';
  /** How much the ground shapes should curve. `none` means every edge is straight. */
  curvature: 'none' | 'some' | 'strong';
  /**
   * How many distinct surface materials a plan of this style should use.
   *
   * The single most reliable difference between a designed garden and an assembled one, and the
   * easiest to measure. Four materials in a small garden reads as indecision whatever they are.
   */
  maxMaterials: number;
  /**
   * How the planting is massed. `runs` is long continuous beds; `masses` is fewer, deeper blocks;
   * `islands-ok` permits detached beds, which every other style scores as fragmentation.
   */
  bedMassing: 'runs' | 'masses' | 'islands-ok';
  /** How strictly features must align to the frame. `strict` is within two degrees. */
  alignment: 'strict' | 'loose';
  /** The circulation styles this look supports, best first. */
  circulation: CirculationStyle[];
  /**
   * How well each layout archetype suits this style, 0 to 1. Absent means "no opinion", which
   * scores as 0.5 — the selector then decides on the site alone.
   *
   * This is what keeps the existing style-to-template claim after the templates become archetypes:
   * formal picks the axis, cottage the sweeping lawn, modern the rectilinear terrace-and-lawn.
   */
  archetypeFit: Partial<Record<LayoutArchetypeId, number>>;
}

const DEFAULT_RULES: StyleRules = {
  symmetry: 'preferred',
  curvature: 'some',
  maxMaterials: 4,
  bedMassing: 'runs',
  alignment: 'loose',
  circulation: ['direct', 'perimeter'],
  archetypeFit: { terrace_and_lawn: 0.7, sweeping_lawn: 0.6 },
};

export const STYLE_RULES: Record<StyleDirection, StyleRules> = {
  modern: {
    symmetry: 'preferred',
    curvature: 'none',
    // Fewer, larger surfaces is most of what "modern" means on the ground.
    maxMaterials: 3,
    bedMassing: 'masses',
    alignment: 'strict',
    circulation: ['direct', 'axis'],
    archetypeFit: {
      terrace_and_lawn: 1,
      side_by_side: 0.8,
      destination_garden: 0.7,
      courtyard: 0.7,
      formal_axis: 0.5,
      linear_sequence: 0.5,
      sweeping_lawn: 0.2,
    },
  },

  /* `cottage` is what the step-3 cards call "Natural". */
  cottage: {
    symmetry: 'avoid',
    curvature: 'strong',
    maxMaterials: 4,
    bedMassing: 'runs',
    alignment: 'loose',
    // You should not see the whole garden from the doors: that is the naturalistic move.
    circulation: ['meander', 'perimeter'],
    archetypeFit: {
      sweeping_lawn: 1,
      linear_sequence: 0.8,
      destination_garden: 0.8,
      terrace_and_lawn: 0.5,
      courtyard: 0.4,
      side_by_side: 0.4,
      formal_axis: 0.1,
    },
  },

  /* `formal` is what the cards call "Traditional". */
  formal: {
    symmetry: 'required',
    curvature: 'none',
    maxMaterials: 3,
    bedMassing: 'runs',
    alignment: 'strict',
    circulation: ['axis', 'perimeter'],
    archetypeFit: {
      formal_axis: 1,
      terrace_and_lawn: 0.6,
      courtyard: 0.6,
      linear_sequence: 0.5,
      destination_garden: 0.4,
      side_by_side: 0.3,
      sweeping_lawn: 0.2,
    },
  },

  /* `lowMaintenance` is what the cards call "Minimalist". */
  lowMaintenance: {
    symmetry: 'preferred',
    curvature: 'none',
    // The fewest materials of any style: every junction between two of them is a detail to maintain.
    maxMaterials: 2,
    bedMassing: 'masses',
    alignment: 'strict',
    circulation: ['direct'],
    archetypeFit: {
      courtyard: 1,
      terrace_and_lawn: 0.8,
      side_by_side: 0.8,
      destination_garden: 0.5,
      linear_sequence: 0.4,
      formal_axis: 0.4,
      sweeping_lawn: 0.2,
    },
  },

  other: DEFAULT_RULES,
};

export function styleRules(style: GardenBrief['style']): StyleRules {
  return style ? STYLE_RULES[style] : DEFAULT_RULES;
}

/**
 * How well an archetype suits a style, 0 to 1.
 *
 * Half rather than zero when the style has no opinion, so an unrated pairing is neutral and the
 * site decides. Zero would mean "never", which is a claim only the archetype's own suitability
 * function is entitled to make — it is the one that knows a formal axis cannot work on a wedge.
 */
export function styleFit(style: GardenBrief['style'], archetype: LayoutArchetypeId): number {
  return styleRules(style).archetypeFit[archetype] ?? 0.5;
}
