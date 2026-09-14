import type { DesignBrief } from '@garden-studio/schema';
import { rankArchetypes, type ArchetypeFit } from './archetype-selector.js';
import { previewLayout, type LayoutPreview, type PreviewRequest } from './layout-generator.js';
import type { CandidateParams, SiteAnalysis } from './types.js';

/**
 * Many cheap layouts, so there is something to choose between.
 *
 * The generator drew exactly one plan per slot and offered it. Nothing compared two arrangements of
 * the same garden, because there was never a second one to compare — which is why a parameter like
 * "which side gets the deep border" could exist in the templates and never be exercised.
 *
 * This enumerates the compositions that suit the plot against the variations each of them offers,
 * previews every combination, and hands the field to the selector. It is affordable for one reason:
 * a preview issues no query. Fifty of them cost a few milliseconds; fifty realisations would cost a
 * minute.
 *
 * **Bounded, and seeded where it is not exhaustive.** The point is a field wide enough to contain a
 * better answer than the first guess, not a search. `DESIGN_CANDIDATES` raises the ceiling for the
 * evaluation harness.
 */

/** How many compositions from the ranking are worth previewing. */
const ARCHETYPES_PER_BRIEF = 3;

/** How many variations of each composition. Beyond this they stop differing in ways that show. */
const PARAMS_PER_ARCHETYPE = 6;

/** The most previews one brief will ever produce, whatever the two numbers above multiply to. */
const CEILING = 24;

export interface Candidate {
  id: string;
  /** The brief this was enumerated for. Carried, never inferred back from the shortlist. */
  brief: DesignBrief;
  fit: ArchetypeFit;
  params: CandidateParams;
  preview: LayoutPreview;
}

export interface EnumerateRequest {
  analysis: SiteAnalysis;
  brief: DesignBrief;
  /** Everything `previewLayout` needs that does not vary between candidates. */
  context: Omit<PreviewRequest, 'archetype' | 'params' | 'brief' | 'analysis'>;
}

/**
 * Every layout worth considering for one brief, best-ranked composition first.
 *
 * Order is the tie-break the selector falls back on, so a field where nothing scores clearly still
 * produces the composition the plot and the style agreed on.
 */
export function enumerateCandidates(request: EnumerateRequest): Candidate[] {
  const ranked = rankArchetypes(request.analysis, request.brief).slice(0, ARCHETYPES_PER_BRIEF);
  const ceiling = Number(process.env.DESIGN_CANDIDATES ?? CEILING);

  const candidates: Candidate[] = [];
  for (const fit of ranked) {
    const variations = fit.archetype
      .params(request.analysis, request.brief)
      .slice(0, PARAMS_PER_ARCHETYPE);

    for (const [index, params] of variations.entries()) {
      if (candidates.length >= ceiling) break;
      candidates.push({
        id: `${request.brief.id}-${fit.archetype.id}-${index}`,
        brief: request.brief,
        fit,
        params,
        preview: previewLayout({
          ...request.context,
          archetype: fit.archetype,
          params,
          brief: request.brief,
          analysis: request.analysis,
        }),
      });
    }
  }

  return candidates;
}
