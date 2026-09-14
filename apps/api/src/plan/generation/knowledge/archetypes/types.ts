import type {
  CirculationStyle,
  FunctionalZoneType,
  LayoutArchetypeId,
} from '@garden-studio/schema';
import type { Band } from '../../composition-rules.js';
import type {
  CandidateParams,
  FunctionalZone,
  SiteAnalysis,
  ZonePlan,
} from '../../design/types.js';
import type { LayoutSketch, Room, SketchRequest, SlotKind } from '../../layout/sketch.js';
import type { DesignBrief } from '@garden-studio/schema';

/**
 * A way of composing a garden, and when it is the right one.
 *
 * The three layout templates were already three composition archetypes — a terrace with a lawn
 * behind it, a sweeping lawn between planted bays, a formal axis — and nothing said so. They were
 * picked by `index % 3`, so every plot got all three whatever its shape, and the wire carried only
 * the display name. That is why a wide shallow garden was laid out down an axis it does not have,
 * and why the tests identify a concept by matching a string.
 *
 * An archetype is **a strategy, not a template**. It knows when it works, when it must not be used,
 * how it wants the rooms arranged and what it may vary; the geometry engine adapts it to the plot.
 * `suitability` returning zero is the one hard word: a formal axis on a plot with no axis is not a
 * worse plan, it is the wrong plan.
 */
export interface LayoutArchetype {
  id: LayoutArchetypeId;
  /** What the concept card calls it. */
  name: string;
  summary: string;
  tone: string;

  /**
   * How well **the plot** suits this composition, 0 to 1.
   *
   * Deliberately not a judgement about taste. Every archetype answers only the question it is
   * qualified to answer — whether this garden can hold this arrangement — and `rankArchetypes`
   * folds the style in afterwards, so the two halves are weighed the same way for all seven. The
   * first version let four of them return a site fit and three return a blended one, which is two
   * scales wearing one name.
   *
   * The brief is still passed because some questions about the plot depend on it: whether a lawn
   * was wanted at all, and whether anything was asked for that would be worth walking to.
   *
   * **Zero means never**, and it survives the blend. `reasons` is quoted into the explanation, so
   * a composition that refuses has to say why in a sentence somebody could disagree with.
   */
  suitability(site: SiteAnalysis, brief: DesignBrief): { score: number; reasons: string[] };

  /** The circulation styles this composition supports, best first. */
  circulation: CirculationStyle[];

  /** What share of the garden each thing should come to. Read by the proportion principle. */
  proportions: { terrace: Band; lawn: Band; planting: Band };

  /** The zone types this composition can actually host a room for. */
  hosts: FunctionalZoneType[];

  /**
   * The parameter sets worth trying, best first.
   *
   * Phase 3 enumerates these into candidates. The first entry must be the archetype's default, so a
   * caller that takes only one gets the composition as designed rather than a variation of it.
   */
  params(site: SiteAnalysis, brief: DesignBrief): CandidateParams[];

  /**
   * Where each room goes, in the design frame.
   *
   * Given the zones the brief asked for, returns them with `rect` filled in wherever this
   * composition has a place for one. A zone it cannot host comes back with `rect: null` rather than
   * being dropped: the brief asked for it, and losing it silently is what the explanation exists to
   * prevent.
   */
  zonePattern(
    zones: FunctionalZone[],
    room: Room,
    params: CandidateParams,
    request: SketchRequest,
  ): FunctionalZone[];

  /** The sketch: terrace, lawn, beds, slots, paths and trees, in the frame. */
  sketch(request: SketchRequest, room: Room, plan: ZonePlan, params: CandidateParams): LayoutSketch;
}

/**
 * The composition as its author intended it.
 *
 * `archetype` is filled in per archetype; everything else is the neutral reading. Phase 2 runs
 * entirely on these, which is what makes the golden comparison meaningful — every number the
 * templates draw at these parameters is the number they drew before there were parameters.
 */
export const DEFAULT_PARAMS: Omit<CandidateParams, 'archetype'> = {
  terraceDepth: 1,
  lawnBias: 'gate',
  destination: 'far-diagonal',
  priorityCut: 0,
};

export function defaultParams(archetype: LayoutArchetypeId): CandidateParams {
  return { archetype, ...DEFAULT_PARAMS };
}

/**
 * Which room each slot belongs to.
 *
 * The mapping that turns the old vocabulary into the new one. A slot kind was always a zone and a
 * position within it said in one word — `terrace-end` is "the dining room, at the end of the
 * terrace" — and writing it down is what lets a feature be assigned to a *room* while the fitter
 * goes on working in slots.
 *
 * `lawn-far` maps to `play` rather than to `lawn`: it is the slot at the far end of the lawn, which
 * is where a play area goes, and the lawn itself is composed rather than placed.
 */
export const ZONE_BY_SLOT: Record<SlotKind, FunctionalZoneType> = {
  terrace: 'terrace',
  'beside-terrace': 'dining',
  'terrace-end': 'dining',
  'terrace-corner': 'terrace',
  'far-room': 'destination',
  'lawn-far': 'play',
  utility: 'utility',
  'utility-2': 'productive',
  'axis-end': 'destination',
};

/** The zone a slot kind belongs to. */
export function zoneOfSlot(kind: SlotKind): FunctionalZoneType {
  return ZONE_BY_SLOT[kind];
}
