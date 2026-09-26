import type { DesignBrief } from '@garden-studio/schema';
import { rankArchetypes, type ArchetypeFit } from './archetype-selector.js';
import { previewLayout, type LayoutPreview, type PreviewRequest } from './layout-generator.js';
import type { GeometryLanguage } from '@garden-studio/schema';
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
const PARAMS_PER_ARCHETYPE = 8;

/** What `PARAMS_PER_ARCHETYPE` was before each composition was drawn several ways. */
const PARAMS_BEFORE_DRAWINGS = 6;

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
    /*
     * `DESIGN_DRAWINGS=0` enumerates the archetype's own variations alone, in its default language —
     * the field before languages and framing were candidates — so a benchmark can say what drawing
     * each composition several ways changed, on otherwise identical code.
     */
    const variations =
      process.env.DESIGN_DRAWINGS === '0'
        ? fit.archetype.params(request.analysis, request.brief).slice(0, PARAMS_BEFORE_DRAWINGS)
        : drawings(
            fit.archetype.params(request.analysis, request.brief),
            fit.archetype.languages(request.brief.style),
            request.brief.geometryLanguage,
          ).slice(0, PARAMS_PER_ARCHETYPE);

    const own: Candidate[] = [];
    for (const [index, params] of variations.entries()) {
      if (candidates.length + own.length >= ceiling) break;
      own.push({
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
    /*
     * A variation the composition declined is the hand-drawn template again, not another drawing of
     * the composition — and its preview is the one that flatters: it cannot show the features the
     * realisation will then sample in wherever there is room, so it scores the plan without them.
     * Where some variations composed, the declined ones are dropped; where none did, the template
     * stands, because it is the only drawing of this composition the plot allows.
     */
    const composed = own.filter((candidate) => candidate.preview.sketch.composed);
    candidates.push(...(composed.length > 0 ? composed : own));
  }

  return candidates;
}

/**
 * The parameter sets to preview, as drawings: each of the archetype's own variations in the language
 * it is drawn in by default — the brief's language first, where the brief states one the archetype
 * speaks — interleaved with the same composition drawn the other ways it can be.
 *
 * The composition as designed comes first, as `params()` promises. Then the alternatives worth the
 * most: the default parameters in the other language, and the default parameters with the lawn left
 * unframed; then the rest of the archetype's own variations; then those in the other languages.
 * Interleaved rather than appended because the list is cut at `PARAMS_PER_ARCHETYPE`, and an
 * alternative drawing of the plan as designed tells the scorer more than a fifth nudge of the
 * terrace's depth does.
 *
 * An unframed variant only where the language frames at all, or it draws the identical garden and
 * spends a preview to learn nothing.
 */
export function drawings(
  params: CandidateParams[],
  languages: GeometryLanguage[],
  stated: GeometryLanguage | null,
): CandidateParams[] {
  const ordered =
    stated && languages.includes(stated)
      ? [stated, ...languages.filter((language) => language !== stated)]
      : languages;
  const [first, ...rest] = params;
  if (!first) return [];
  const [main, ...others] = ordered as [GeometryLanguage, ...GeometryLanguage[]];
  const frames = main === 'rectilinear' || main === 'asymmetric_geometric';
  return [
    { ...first, language: main },
    ...others.map((language) => ({ ...first, language })),
    ...(frames ? [{ ...first, language: main, framed: false }] : []),
    ...rest.map((variation) => ({ ...variation, language: main })),
    ...others.flatMap((language) => rest.map((variation) => ({ ...variation, language }))),
  ];
}
