import type { DesignBrief, DesignScore } from '@garden-studio/schema';
import { elementsFromPreview } from './adapters.js';
import { enumerateCandidates, type Candidate, type EnumerateRequest } from './candidates.js';
import { evaluateDesign } from './evaluate/index.js';
import { pickDistinct, signatureOf, type Scored, type Signature } from './diversity.js';
import { repairCandidate } from './repair.js';
import { NO_ADJUSTMENTS, type LayoutAdjustments, type SiteAnalysis } from './types.js';

/**
 * Generate, score, choose — the loop the whole design agent was built to make possible.
 *
 * ```
 *   briefs ─┬─ enumerate     compositions that suit the plot × the variations each offers
 *           ├─ preview       a pure layout apiece: no query, a few milliseconds for the lot
 *           ├─ score         the same nine principles the finished plan is judged on
 *           ├─ choose        best first, then best-that-is-different, then best-that-is-different
 *           └─ repair        the chosen one's own worst fault, fixed if fixing it measurably helps
 * ```
 *
 * Three properties are worth keeping if any of this changes.
 *
 * **The three slots are chosen together, never one at a time.** Being different is a property of the
 * *set*, and a loop that picked each slot's best independently would happily return the same plan
 * three times. The old generator got this right by accident by drawing all three templates.
 *
 * **A candidate is scored on what it drew, not on what it was asked to draw.** Parameters that make
 * no difference on a particular plot produce identical gardens, and a signature over the inputs
 * would call them different.
 *
 * **What is chosen is a decision, not a drawing.** The winner is an archetype, a set of parameters
 * and whatever the repair stage adjusted; the real pipeline then builds that plan with the sampler,
 * the fill passes and the lighting. The preview is a means of choosing, and is thrown away — which
 * is why it can afford to be a simplification and why the finalist is rescored at the realised tier
 * afterwards.
 *
 * **Repair comes after the choice, never before it.** Repairing the whole field would cost fifty
 * times as much for an answer the diversity filter then throws most of away, and — worse — it would
 * converge the field: every candidate repaired towards the same objective is every candidate
 * becoming the same plan, which is precisely what three cards must not be. Choose for variety, then
 * improve each choice on its own terms.
 */

export interface ChosenLayout {
  brief: DesignBrief;
  candidate: Candidate;
  /** The preview's own score, after repair. The concept carries the realised one instead. */
  structural: DesignScore;
  /** How much of the field was looked at, for the harness to report. */
  considered: number;
  /** What the repair stage changed. Realisation must honour every part of it. */
  adjustments: LayoutAdjustments;
  /** What was repaired, as sentences, for the concept's explanation. */
  repairs: string[];
}

export interface ChooseRequest {
  analysis: SiteAnalysis;
  briefs: DesignBrief[];
  /** Everything the preview needs that does not vary between candidates or briefs. */
  context: EnumerateRequest['context'];
}

/**
 * One layout per concept slot, distinct from each other.
 *
 * Slot A takes the best candidate outright: it is the recommendation, and a recommendation should
 * be the best answer rather than the best *different* answer. B and C are then chosen against what
 * is already on the table.
 */
export function chooseLayouts(request: ChooseRequest): ChosenLayout[] {
  const fields = request.briefs.map((brief) =>
    scoreField(
      enumerateCandidates({ analysis: request.analysis, brief, context: request.context }),
      request,
    ),
  );

  const chosen: ChosenLayout[] = [];
  const taken: Signature[] = [];

  for (const [index, brief] of request.briefs.entries()) {
    const own = fields[index] ?? [];
    /*
     * A brief whose own field is empty — no composition survived its reading of the plot — falls
     * back to the other briefs' candidates rather than producing no concept. The screen has three
     * cards, and a card that says "nothing is possible here" is worse than a near-duplicate.
     */
    const field = own.length > 0 ? own : fields.flat();
    const picked = pickDistinct(field, index === 0 ? [] : taken);
    if (!picked) continue;

    /*
     * The chosen plan's own worst fault, fixed where fixing it measurably helps. The signature is
     * taken from the *repaired* preview, because what the next slot must differ from is the garden
     * that will actually be offered — taking it before would have slot B avoiding a plan that no
     * longer exists.
     */
    const repaired = repairCandidate({
      candidate: picked.candidate,
      score: picked.score,
      analysis: request.analysis,
      context: request.context,
    });

    taken.push(signatureOf(repaired.candidate.preview));
    chosen.push({
      brief,
      candidate: repaired.candidate,
      structural: repaired.score,
      considered: field.length,
      adjustments: repaired.adjustments,
      repairs: repaired.repairs,
    });
  }

  return chosen;
}

/** The empty adjustment set, re-exported so a caller with no chosen layout has the same shape. */
export { NO_ADJUSTMENTS };

/**
 * Every candidate scored, worst dropped.
 *
 * A candidate carrying a critical fault — no terrace at the doors, an essential feature nowhere —
 * is removed rather than ranked last, for the reason a refused archetype is: it is not a worse plan,
 * it is not a plan. If that empties the field the caller falls back, and the plot in question is one
 * where the realisation path is going to do the work anyway.
 */
function scoreField(candidates: Candidate[], request: ChooseRequest): Scored[] {
  const scored = candidates.map((candidate) => {
    const { elements, featureOf } = elementsFromPreview(candidate.preview, request.context.zoneAt);
    return {
      candidate,
      score: evaluateDesign({
        elements,
        analysis: request.analysis,
        brief: candidate.brief,
        featureOf,
        tier: 'structural',
      }),
    };
  });

  const clean = scored.filter(
    (entry) => !entry.score.issues.some((issue) => issue.severity === 'critical'),
  );
  return clean.length > 0 ? clean : scored;
}
