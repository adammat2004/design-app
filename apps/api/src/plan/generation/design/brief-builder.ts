import {
  DesignBriefSchema,
  type BriefEmphasis,
  type BriefSlot,
  type CirculationStyle,
  type DesignBrief,
  type FocalStrategy,
  type FunctionalZoneType,
  type GardenBrief,
  type GardenIntent,
  type LayoutArchetypeId,
  type PrivacyStrategy,
} from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import { styleFit, styleRules } from '../knowledge/style-rules.js';
import { withinCapacity } from './requirements.js';
import type { Requirements, SiteAnalysis } from './types.js';

/**
 * The strategy for a concept, decided before a single coordinate exists.
 *
 * This is the seam the whole agent turns on. Everything downstream reads a `DesignBrief` and not
 * the raw one: "the user ticked pergola" has become "the dining room is the primary zone, the
 * pergola is preferred within it, the plan is laid out on an axis, and the pond is excluded because
 * there is no room for it without losing the lawn".
 *
 * Deterministic. A model may later revise one of these — that is what the strategic-brief call is
 * for — but this is both the answer it revises and the answer the system falls back to with no key,
 * which is not a degraded mode: every claim in a brief built here is derived from something the
 * user actually said.
 *
 * **Slot A is the intent-led reading and is always the recommendation.** B and C are the same brief
 * read with a different emphasis, which is what makes the comparison screen worth having — three
 * concepts that differ in what they are *for* rather than in which template came third in a list.
 */

/**
 * The emphasis each slot takes, given what the garden is primarily for.
 *
 * Slot A answers the intent; the other two lean in directions that are genuinely different *and*
 * genuinely plausible for that intent. An entertaining garden's alternatives are "more open" and
 * "more planted", not "more productive" — a second reading has to be one somebody might actually
 * prefer, or the card beside the recommendation is decoration.
 */
const EMPHASES: Record<GardenIntent, [BriefEmphasis, BriefEmphasis, BriefEmphasis]> = {
  entertaining: ['social', 'open', 'planted'],
  family: ['open', 'social', 'planted'],
  relaxation: ['planted', 'open', 'social'],
  gardening: ['productive', 'planted', 'open'],
  lowMaintenance: ['planted', 'open', 'social'],
  showcase: ['planted', 'social', 'open'],
  mixed: ['open', 'social', 'planted'],
};

/** What each emphasis organises the garden around, when the features allow it. */
const EMPHASIS_ZONE: Record<BriefEmphasis, FunctionalZoneType> = {
  social: 'dining',
  open: 'lawn',
  planted: 'planting',
  productive: 'productive',
};

/** How an emphasis reads as a sentence, for the rationale and the concept card. */
const EMPHASIS_WORDS: Record<BriefEmphasis, string> = {
  social: 'built round eating and entertaining outside',
  open: 'built round one generous open lawn',
  planted: 'built round deep planting and somewhere quiet to sit in it',
  productive: 'built round growing things, with the working areas given proper room',
};

export function buildBriefs(
  brief: GardenBrief,
  requirements: Requirements,
  analysis: SiteAnalysis,
): DesignBrief[] {
  const slots: BriefSlot[] = ['A', 'B', 'C'];
  const emphases = EMPHASES[requirements.intent];

  return slots.map((slot, index) =>
    buildBrief(slot, emphases[index]!, brief, requirements, analysis),
  );
}

export function buildBrief(
  id: BriefSlot,
  emphasis: BriefEmphasis,
  brief: GardenBrief,
  requirements: Requirements,
  analysis: SiteAnalysis,
): DesignBrief {
  const { keep, cut } = withinCapacity(requirements);
  const kept = new Set(keep);

  /*
   * The zones this concept is organised into, from the features that survived the capacity cut.
   * A zone with nothing in it is not a zone — the composed three aside, which are passes that run
   * over the whole plan and so always have a zone to claim.
   */
  const claimed = new Set<FunctionalZoneType>();
  for (const entry of requirements.priorities) {
    const knowledge = FEATURE_LIBRARY[entry.feature];
    if (!knowledge.composed && !kept.has(entry.feature)) continue;
    claimed.add(knowledge.zone);
  }
  /* Every garden has a terrace at the doors, whether or not anything was ticked for it. */
  claimed.add('terrace');

  const primaryZone = choosePrimary(emphasis, claimed, requirements);
  const secondaryZones = [...claimed]
    .filter((zone) => zone !== primaryZone && isSecondary(zone))
    .slice(0, 4);
  const supportingZones = [...claimed]
    .filter((zone) => zone !== primaryZone && !secondaryZones.includes(zone))
    .slice(0, 6);

  const circulation = chooseCirculation(brief, analysis, emphasis);
  const focal = chooseFocal(brief, kept, analysis);

  return DesignBriefSchema.parse({
    id,
    intent: requirements.intent,
    emphasis,
    primaryZone,
    secondaryZones,
    supportingZones,
    archetypeShortlist: shortlist(brief, analysis, emphasis),
    circulation,
    focal,
    privacy: choosePrivacy(analysis),
    featurePriorities: requirements.priorities.map((entry) => ({
      feature: entry.feature,
      /*
       * A cut feature keeps the tier it earned and appears in `excludedFeatures` as well. Demoting
       * it to optional would lose the information the explanation needs: "this was worth having and
       * there was no room" is a different sentence from "this was never a priority".
       */
      tier: entry.tier,
      reason: entry.reason,
    })),
    excludedFeatures: cut,
    style: brief.style,
    rationale: rationaleFor(emphasis, requirements, primaryZone, cut.length),
  });
}

/**
 * The room the whole plan is organised around.
 *
 * The emphasis proposes and the features dispose: an `open` reading of a garden with no lawn asked
 * for and no room for one falls back to whatever zone actually holds the most important feature.
 * Proposing a primary zone the plan cannot build is how a concept comes to claim something that is
 * not in the drawing.
 */
function choosePrimary(
  emphasis: BriefEmphasis,
  claimed: Set<FunctionalZoneType>,
  requirements: Requirements,
): FunctionalZoneType {
  const wanted = EMPHASIS_ZONE[emphasis];
  if (claimed.has(wanted)) return wanted;

  const first = requirements.priorities.find((entry) =>
    claimed.has(FEATURE_LIBRARY[entry.feature].zone),
  );
  return first ? FEATURE_LIBRARY[first.feature].zone : 'terrace';
}

/** A zone that can be a room of its own, as opposed to one that runs through the whole plan. */
function isSecondary(zone: FunctionalZoneType): boolean {
  return !['planting', 'transition', 'passage', 'arrival'].includes(zone);
}

/**
 * How you get round this garden.
 *
 * The style's own preference, narrowed by the site: a meandering route needs somewhere to meander,
 * and on a room under about eight metres deep a curve is a wiggle. That is the kind of rule the
 * style table cannot hold on its own, because it is a fact about the plot rather than about taste.
 */
function chooseCirculation(
  brief: GardenBrief,
  analysis: SiteAnalysis,
  emphasis: BriefEmphasis,
): CirculationStyle {
  const preferred = styleRules(brief.style).circulation;
  const depth = analysis.roomDepth ?? 0;

  for (const style of preferred) {
    if (style === 'meander' && depth < 8) continue;
    if (style === 'axis' && depth < 6) continue;
    /* A planted concept is the one that earns a route round the edge rather than straight down it. */
    if (style === 'perimeter' && emphasis !== 'planted' && preferred.length > 1) continue;
    return style;
  }
  return 'direct';
}

/**
 * What terminates the view from the doors.
 *
 * Only ever something the garden actually contains. Claiming a water feature as the focal point of
 * a plan with no water in it is the class of silent fiction `suggestedDoorWall` exists to avoid —
 * the whole value of a strategy is that the geometry engine trusts it.
 */
function chooseFocal(brief: GardenBrief, kept: Set<string>, analysis: SiteAnalysis): FocalStrategy {
  if (kept.has('water')) return 'water';
  if (brief.style === 'formal' && (analysis.roomDepth ?? 0) >= 8) return 'axis-end';
  if ((analysis.roomDepth ?? 0) >= 7) return 'far-corner';
  return 'none';
}

/**
 * What the planting is asked to screen.
 *
 * Read off the boundaries the user actually described. A plot with an undescribed perimeter gets
 * `none` — there is nothing to screen it from that anybody has stated, and planting a screen
 * against an imagined neighbour is the same mistake as assuming a latitude.
 */
function choosePrivacy(analysis: SiteAnalysis): PrivacyStrategy {
  const exposed = analysis.edges.filter((edge) => edge.exposure !== 'unknown');
  if (exposed.length === 0) return 'none';

  const streetSide = exposed.some((edge) => edge.exposure === 'street' && edge.side !== 'front');
  if (streetSide) return 'screen-street';

  /* A low boundary on two or more sides is what "enclose" is actually for. */
  const low = exposed.filter((edge) => edge.height < 1.7);
  if (low.length >= 2) return 'enclose';
  return exposed.length > 0 ? 'screen-neighbours' : 'none';
}

/**
 * Which layouts are worth trying, best first.
 *
 * Ranked by the style's own fit, with the emphasis breaking ties — the site then decides, because
 * an archetype's own `suitability` is the only thing entitled to say "never on this plot". Keeping
 * the style's first choice at the head of the list is what preserves the existing style-to-template
 * claim: formal still gets the axis, natural still gets the sweeping lawn.
 */
function shortlist(
  brief: GardenBrief,
  analysis: SiteAnalysis,
  emphasis: BriefEmphasis,
): LayoutArchetypeId[] {
  const all: LayoutArchetypeId[] = [
    'terrace_and_lawn',
    'sweeping_lawn',
    'formal_axis',
    'side_by_side',
    'linear_sequence',
    'courtyard',
    'destination_garden',
  ];

  const bias = (archetype: LayoutArchetypeId): number => {
    /* A first, cheap read of the site, so an obviously wrong shape never heads the list. */
    if (analysis.shape === 'wide' && archetype === 'side_by_side') return 0.25;
    if (analysis.shape === 'long' && archetype === 'linear_sequence') return 0.25;
    if (analysis.shape === 'courtyard' && archetype === 'courtyard') return 0.4;
    if (analysis.shape === 'courtyard' && archetype !== 'courtyard') return -0.4;
    if (emphasis === 'social' && archetype === 'destination_garden') return 0.1;
    if (emphasis === 'open' && archetype === 'terrace_and_lawn') return 0.1;
    return 0;
  };

  return all
    .map((archetype) => ({ archetype, fit: styleFit(brief.style, archetype) + bias(archetype) }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 3)
    .map((entry) => entry.archetype);
}

function rationaleFor(
  emphasis: BriefEmphasis,
  requirements: Requirements,
  primaryZone: FunctionalZoneType,
  excluded: number,
): string {
  const essentials = requirements.priorities
    .filter((entry) => entry.tier === 'essential')
    .map((entry) => FEATURE_LIBRARY[entry.feature].zone);

  const parts = [
    `A garden ${EMPHASIS_WORDS[emphasis]}, organised around the ${primaryZone} area.`,
    essentials.length > 0
      ? `The ${unique(essentials).join(' and ')} ${essentials.length > 1 ? 'areas are' : 'area is'} what this concept is not worth offering without.`
      : '',
    excluded > 0 ? `${excluded} of the things asked for are left out rather than crowded in.` : '',
  ];

  return parts.filter(Boolean).join(' ').slice(0, 400);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
