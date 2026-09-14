import type { DesignBrief, LayoutArchetypeId } from '@garden-studio/schema';
import { ARCHETYPES, archetypeById } from '../knowledge/archetypes/index.js';
import { styleFit } from '../knowledge/style-rules.js';
import type { LayoutArchetype } from '../knowledge/archetypes/types.js';
import type { SiteAnalysis } from './types.js';

/**
 * Which composition suits this plot and this brief, and which cannot work on it at all.
 *
 * The generator picked its layout with `index % 3`. Every plot got a terrace-and-lawn plan, a
 * sweeping lawn and a formal axis, in that order, whatever its shape — which is why a nine-metre
 * courtyard was offered an axis and a twenty-two-metre-wide shallow plot was offered three plans
 * that all lay their rooms front to back.
 *
 * Here each composition answers for itself. A score of zero is a refusal and is honoured: an
 * archetype that says it cannot work on this plot is never offered, however well it suits the
 * style. The style is the *other* half of the question and it cannot overrule the plot — a formal
 * brief on a plot with no axis gets the next-best formal-leaning plan, not a formal plan that does
 * not fit.
 *
 * Deterministic and pure. Given a site and a brief the ranking is fixed, so a regenerate rolls the
 * seed rather than the shortlist.
 */

export interface ArchetypeFit {
  archetype: LayoutArchetype;
  score: number;
  /** Why, in sentences. Quoted into the concept's explanation. */
  reasons: string[];
  /** Whether the brief named it. Decides between compositions the plot cannot separate. */
  shortlisted: boolean;
}

/**
 * Every composition that could work here, best first.
 *
 * Refusals are dropped rather than ranked last: "this cannot work" and "this works badly" are
 * different answers, and offering the first as a low-scoring option is how a courtyard came to be
 * offered an axis.
 */
export function rankArchetypes(site: SiteAnalysis, brief: DesignBrief): ArchetypeFit[] {
  return ARCHETYPES.map((archetype) => {
    const { score, reasons } = archetype.suitability(site, brief);
    /*
     * A refusal survives the blend. Multiplying a zero by a style weight would let a strongly
     * style-matched composition creep back in on a plot that cannot hold it, which is the exact
     * failure this layer exists to stop — a formal axis offered on a courtyard.
     */
    if (score <= 0) return { archetype, score: 0, reasons, shortlisted: false };

    const style = styleFit(brief.style, archetype.id);
    return {
      archetype,
      score: clamp(score * SITE_WEIGHT + style * STYLE_WEIGHT),
      reasons: style >= 0.8 ? [...reasons, styleReason(brief)] : reasons,
      shortlisted: brief.archetypeShortlist.includes(archetype.id),
    };
  })
    .filter((fit) => fit.score > 0)
    .sort(
      (a, b) =>
        nearTie(a.score, b.score) ||
        Number(b.shortlisted) - Number(a.shortlisted) ||
        b.score - a.score ||
        order(a.archetype.id) - order(b.archetype.id),
    );
}

/**
 * How the plot and the taste are weighed against each other.
 *
 * **Evenly, and that is the argument rather than a tuning.** The two questions are different and
 * neither is subordinate: "can this garden hold this arrangement" and "is this the kind of garden
 * they asked for". Weighting the site higher makes the style cards decoration, which is the failure
 * CLAUDE.md records for a style direction that falls through to the defaults. Weighting taste
 * higher puts an axis on a plot with no axis.
 *
 * What stops the tie being arbitrary is that a refusal is absolute: the style never gets to vote on
 * a composition the plot has already ruled out.
 */
const SITE_WEIGHT = 0.5;
const STYLE_WEIGHT = 0.5;

/**
 * How close two compositions have to score before the brief's shortlist decides between them.
 *
 * **A tie-break, and emphatically not a bonus.** The first attempt added a tenth to any shortlisted
 * composition's score, and the benchmark said no: mean 0.872 → 0.868 and, more tellingly, the worst
 * plan in the fixture set fell 0.739 → 0.680. The site-and-style ranking is simply a better judge of
 * which arrangement suits a plot than the strategic layer's shortlist is, and a thumb on the scale
 * cost exactly what you would expect.
 *
 * What survives is the narrow claim the measurement supports: where two compositions are within
 * three points of each other the plot has no real opinion, and the brief's preference is a better
 * reason to choose than the alphabetical order that decided it before. It cannot overturn a clear
 * verdict, by construction, and it cannot resurrect a refusal, because the filter runs first.
 *
 * That matters most for the strategic brief a model writes. The field was previously read by
 * nothing at all — the "tick the design ignores" failure recorded twice elsewhere in these notes —
 * so offering a model a shortlist that changed no drawing would have been the third.
 */
const NEAR_TIE = 0.03;

/** Zero when two scores are too close to separate, so the next comparison decides. */
function nearTie(a: number, b: number): number {
  return Math.abs(a - b) < NEAR_TIE ? 0 : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function styleReason(brief: DesignBrief): string {
  const style =
    brief.style === 'cottage'
      ? 'naturalistic'
      : brief.style === 'formal'
        ? 'traditional'
        : brief.style === 'lowMaintenance'
          ? 'minimalist'
          : (brief.style ?? 'chosen');
  return `It is also the ${style} answer, which is the look asked for.`;
}

/**
 * The composition for one concept slot, and the two the other slots take.
 *
 * **Slot A is the best fit and is the recommendation.** B and C are the next two *distinct*
 * compositions, so the three concepts are three shapes of plan rather than three rolls of one —
 * which is the property the fixed `index % 3` had by accident and this has on purpose.
 *
 * The fallback matters as much as the ranking. A plot on which only one composition works still has
 * to produce three concepts, because the screen has three cards: the ranking is cycled rather than
 * truncated, so the second and third slots repeat the best fit and differ on their parameters and
 * their brief instead. A card that says "no plan is possible here" would be worse than a variation.
 */
export function archetypesForSlots(
  site: SiteAnalysis,
  briefs: DesignBrief[],
): { id: LayoutArchetypeId; fit: ArchetypeFit }[] {
  const ranked = rankArchetypes(site, briefs[0] ?? briefs[0]!);

  if (ranked.length === 0) {
    /*
     * Nothing scored above zero, which means every composition refused. The only plots that manage
     * this have no room behind the doors at all, and they are the ones `build` already designs with
     * the sampler rather than the grammar — so the terrace-and-lawn plan is named as a placeholder
     * and its own courtyard branch does the work.
     */
    const fallback: ArchetypeFit = {
      archetype: archetypeById('terrace_and_lawn'),
      score: 0,
      reasons: ['No composition fits this plot, so the placer works without one.'],
      shortlisted: false,
    };
    return briefs.map(() => ({ id: fallback.archetype.id, fit: fallback }));
  }

  return briefs.map((_brief, index) => {
    const fit = ranked[index % ranked.length]!;
    return { id: fit.archetype.id, fit };
  });
}

/** The best composition for a brief on this site, with the reasons it won. */
export function bestArchetype(site: SiteAnalysis, brief: DesignBrief): ArchetypeFit {
  const ranked = rankArchetypes(site, brief);
  return (
    ranked[0] ?? {
      archetype: archetypeById('terrace_and_lawn'),
      score: 0,
      reasons: ['No composition fits this plot, so the placer works without one.'],
    }
  );
}

/**
 * Why an archetype was not offered, for the plots where the interesting answer is a refusal.
 *
 * Only used by the tests and the harness today. It is the half of the decision a user never sees
 * and a developer most needs: "the formal axis was refused because the room is 5.4 m deep" is what
 * turns an unexpected concept set into an explicable one.
 */
export function refusals(
  site: SiteAnalysis,
  brief: DesignBrief,
): { id: LayoutArchetypeId; reasons: string[] }[] {
  return ARCHETYPES.map((archetype) => ({ archetype, ...archetype.suitability(site, brief) }))
    .filter((fit) => fit.score === 0)
    .map((fit) => ({ id: fit.archetype.id, reasons: fit.reasons }));
}

/** Registry order, the tie-break when two compositions score the same. */
function order(id: LayoutArchetypeId): number {
  return ARCHETYPES.findIndex((archetype) => archetype.id === id);
}
