import { z } from 'zod';

/**
 * What a layout scores, and what is wrong with it.
 *
 * The generator has never had an objective function. Every choice in it is first-fit: the first
 * legal placement wins, the first free slot wins, the first route that does not cross an obstacle
 * wins. That produces a legal garden and says nothing about whether it is a good one, which is why
 * nothing could ever compare two layouts or know that a repair had helped.
 *
 * A score is **more than one number** on purpose. A total alone can only rank; the per-principle
 * breakdown says *why* one candidate beat another, and `issues` is what the repair stage acts on
 * and what the explanation quotes. The categories are the design principles a landscape designer
 * would name, which is also what makes the system inspectable — "this concept scored 0.4 on
 * circulation because the path to the shed detours 2.1×" is a sentence a person can argue with.
 *
 * Like `composition.ts`, this has **no authority over geometry**. A score never moves a coordinate;
 * it only decides which already-legal candidate is offered. Delete the scorer and the generator
 * still produces valid plans, just arbitrary ones.
 */

/**
 * The design principles a layout is judged on.
 *
 * `featureFit` is a gate rather than a weighted category — a concept missing an essential feature
 * is not a slightly worse concept, it is the wrong concept — and `sun` only applies when the site
 * has a location, for the same reason `shadowCast` returns null without one.
 */
export const PrincipleIdSchema = z.enum([
  'circulation',
  'grouping',
  'proportion',
  'relationships',
  'privacy',
  'hierarchy',
  'style',
  'buildability',
  'featureFit',
  'sun',
]);
export type PrincipleId = z.infer<typeof PrincipleIdSchema>;

/**
 * How bad a problem is.
 *
 * `critical` means the candidate is not offerable at all — a missing essential, a zone nothing can
 * reach. `major` is a real design fault worth repairing. `minor` is a preference that was not met.
 * Only `critical` removes a candidate from selection; the rest are weighted into the score.
 */
export const IssueSeveritySchema = z.enum(['critical', 'major', 'minor']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

/**
 * The things that can be wrong with a garden layout, named.
 *
 * Codes rather than sentences, for the reason `ViolationCode` is: the message is for a person and
 * may be reworded, the code is what the repair table and the tests key on. They name what is wrong
 * rather than what to do about it — the `repair` field is the separate opinion about the fix.
 */
export const DesignIssueCodeSchema = z.enum([
  /* featureFit */
  'missing-essential',
  'feature-density',
  /* grouping */
  'feature-outside-zone',
  'zone-fragmented',
  /* proportion */
  'terrace-too-shallow',
  'terrace-oversized',
  'lawn-sliver',
  'lawn-fragmented',
  'hard-excessive',
  'leftover-pocket',
  /* circulation */
  'route-missing',
  'route-detour',
  'route-through-feature',
  'route-through-planting',
  'route-pinch',
  'route-dead-end',
  'route-too-narrow',
  /* relationships */
  'shed-in-view',
  'play-not-visible',
  'play-near-hazard',
  'bbq-far-from-dining',
  'relationship-unmet',
  /* privacy */
  'seating-exposed',
  /* hierarchy */
  'no-focal',
  'view-blocked',
  'no-primary-space',
  /* style */
  'misaligned',
  'too-many-materials',
  'bed-islands',
  /* buildability */
  'bed-too-narrow',
  'feature-against-fence',
  'steps-missing',
  /* sun */
  'seating-in-shade',
]);
export type DesignIssueCode = z.infer<typeof DesignIssueCodeSchema>;

/**
 * What the repair stage may try for an issue.
 *
 * On the issue rather than in a lookup table keyed by code, because the same code can want
 * different fixes depending on what produced it: a lawn sliver caused by a deep border wants the
 * border narrowed, one caused by the terrace wants the terrace shrunk. The detector knows which.
 */
export const RepairKindSchema = z.enum([
  'shrink-terrace',
  'move-to-zone',
  'drop-optional',
  'reroute',
  'widen-path',
  'merge-beds',
  'enlarge-lawn',
  'move-tree',
  'align',
  'move-destination',
]);
export type RepairKind = z.infer<typeof RepairKindSchema>;

export const DesignIssueSchema = z.object({
  code: DesignIssueCodeSchema,
  principle: PrincipleIdSchema,
  severity: IssueSeveritySchema,
  /** One sentence, measured rather than asserted: "the path to the shed runs 2.1× the direct line". */
  message: z.string().max(240),
  /**
   * What the issue is about: element ids where they exist, else zone ids or feature names. The
   * repair stage uses these to know what to move; the explanation uses them to point at something.
   */
  subjects: z.array(z.string()).max(8).default([]),
  repair: RepairKindSchema.optional(),
});
export type DesignIssue = z.infer<typeof DesignIssueSchema>;

/**
 * Which pass produced the score.
 *
 * `structural` is the cheap pure-TypeScript reading over a candidate's sketched rectangles, run on
 * every one of the fifty-odd candidates. `realised` is the same principles re-read over the
 * finished element list once PostGIS has cut the beds and clipped the lawn, and only the finalists
 * pay for it. They can genuinely disagree — a lawn that was one rectangle in the sketch can come
 * back from `remainderPieces` as three — and that disagreement is the point of running the second.
 */
export const ScoreTierSchema = z.enum(['structural', 'realised']);
export type ScoreTier = z.infer<typeof ScoreTierSchema>;

export const DesignScoreSchema = z.object({
  /** The weighted mean of the categories, 0–1, after the `featureFit` gate is applied. */
  total: z.number().min(0).max(1),
  /**
   * Per principle, 0–1. Partial rather than total: a principle that does not apply to this site —
   * `sun` without a location — is absent rather than scored zero, and its weight is redistributed.
   */
  categories: z.record(PrincipleIdSchema, z.number().min(0).max(1)),
  issues: z.array(DesignIssueSchema).default([]),
  tier: ScoreTierSchema,
});
export type DesignScore = z.infer<typeof DesignScoreSchema>;

/** Whether anything here disqualifies the candidate outright. */
export function hasCritical(score: DesignScore): boolean {
  return score.issues.some((issue) => issue.severity === 'critical');
}

/** Issues at or above a severity, worst first — the order the repair stage works in. */
export const SEVERITY_ORDER: IssueSeverity[] = ['minor', 'major', 'critical'];

export function issuesBySeverity(score: DesignScore): DesignIssue[] {
  return [...score.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity),
  );
}
