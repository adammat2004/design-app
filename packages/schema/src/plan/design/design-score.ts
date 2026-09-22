import { z } from 'zod';
import { FunctionalZoneTypeSchema } from './vocabulary.js';

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
 * has a location, for the same reason `shadowCast` returns null without one. `maintenanceFit` is
 * conditional in the same way: it applies only when the user stated how much upkeep they want, and
 * a plan drawn before anybody asked is not marked down for an answer nobody gave.
 *
 * `canopy` is the third conditional one and the reason it exists is worth stating: every other
 * principle can be satisfied by a garden with no trees in it, so a plan with three specimens
 * marooned in open lawn scored exactly as well as one with a boundary of them — and the candidate
 * loop, which only ever prefers what it can measure, had no reason to choose the fuller garden.
 * It applies only where there is a room big enough for trees to be a question at all.
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
  'maintenanceFit',
  'canopy',
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
  /**
   * Inside the traced bands and outside what this concept's own emphasis asks for.
   *
   * A separate code from `hard-excessive` on purpose: that one says the plan is out of proportion
   * for any garden, this one says it is the wrong proportion for *this* garden. A plan the bands
   * pass and the brief does not is a difference of intention, not a defect.
   */
  'composition-off-brief',
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
  /* maintenanceFit */
  'upkeep-heavy',
  /* canopy */
  'sparse-canopy',
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

/**
 * What a good answer to this fault would satisfy — never what it would be.
 *
 * The gap this closes was the largest one left in the design agent: the scorer could say *what* is
 * wrong and never *where* the thing should go instead, so seven of the ten repair kinds could not be
 * performed at all. Mapped to the only destinations an intent could name — the house, a fence, a
 * zone the scorer never mentioned — the planner refused every one of them across four fixtures with
 * "it is already as far that way as it will go", because the things these faults are about are
 * against a fence already.
 *
 * So an issue may now carry constraints, and **every one of them is a relation, never a position.**
 * There is nowhere here to put an x, a y, a centre or a ring — the same property `DesignIntent`,
 * `GardenAction` and `DesignBrief` have, tested the same way by walking the schema's property names.
 * The reviewer describes the relationship it wants; the deterministic planner searches for geometry
 * that satisfies it, and reports when nothing does.
 *
 * Everything is optional. An issue with no guidance is exactly the issue this file carried before,
 * and a repair planner that meets one falls back to what it could already do.
 */
export const IssueGuidanceSchema = z.object({
  /** Element ids the subject should end up near, and how near. */
  near: z.array(z.string()).max(8).optional(),
  nearM: z.number().positive().optional(),
  /** Element ids it should end up clear of, and by how much. */
  awayFrom: z.array(z.string()).max(8).optional(),
  awayM: z.number().positive().optional(),
  /**
   * Things a garden has that are not elements, so a rule about the doorway or the side gate can be
   * stated without inventing an id for the house.
   */
  nearAnchor: z.enum(['house', 'gate']).optional(),
  awayFromAnchor: z.enum(['house', 'gate', 'street']).optional(),
  /** Whether it should be inside the view cone from the garden doors, or out of it. */
  inView: z.boolean().optional(),
  outOfView: z.boolean().optional(),
  /** Whether it should stand where the afternoon sun reaches. Only ever set on a located plan. */
  sunlit: z.boolean().optional(),
  /** Boundary edges it should have something between it and, by `SiteEdge.vertexId`. */
  screenFrom: z.array(z.string()).max(4).optional(),
  /** How far it should stand off the boundary — a maintenance gap, not a position. */
  clearOfBoundaryM: z.number().positive().optional(),
  /** An element it must stay wholly inside: furniture does not leave the terrace it stands on. */
  keepWithin: z.string().optional(),
  /** The kind of room it belongs in, when the scorer knows which. */
  preferZone: FunctionalZoneTypeSchema.optional(),
  /** For a route: element ids it should stop passing through or squeezing between. */
  avoid: z.array(z.string()).max(8).optional(),
  /** For a route: the element it has to reach. */
  connect: z.string().optional(),
  /** For a route: how wide it should come back. */
  minWidthM: z.number().positive().optional(),
  /** How much bigger or smaller, as a factor on area. The planner turns it into a legal size. */
  targetAreaFactor: z.number().positive().optional(),
  /** What it should be square to. */
  alignTo: z.enum(['house', 'boundary']).optional(),
});
export type IssueGuidance = z.infer<typeof IssueGuidanceSchema>;

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
  /** What a valid correction would have to achieve. See `IssueGuidanceSchema`. */
  guidance: IssueGuidanceSchema.optional(),
  /**
   * Which critic found it.
   *
   * There is one critic today and it measures geometry. A vision critic reading the rendered picture
   * — composition, dead ground, visual balance — would produce issues in this same shape, and the
   * whole point of naming the source is that the repair pipeline does not have to care which it was.
   * Defaulted, so every existing emitter is a geometry finding without saying so.
   */
  source: z.enum(['geometry', 'visual']).default('geometry'),
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
  /**
   * The weights actually applied, renormalised over whatever was measured.
   *
   * The total is a weighted mean and the weights now follow the brief, so without this the number
   * cannot be explained: "why did A score 0.82 and B 0.74" is answerable from the categories only
   * when you also know what each was worth. Optional, so a score stored before the weighting
   * existed still parses and still reads as the fixed table it was measured against.
   */
  weights: z.record(PrincipleIdSchema, z.number().min(0)).optional(),
});
export type DesignScore = z.infer<typeof DesignScoreSchema>;

/** Whether anything here disqualifies the candidate outright. */
export function hasCritical(score: DesignScore): boolean {
  return score.issues.some((issue) => issue.severity === 'critical');
}

/** Issues at or above a severity, worst first — the order the repair stage works in. */
export const SEVERITY_ORDER: IssueSeverity[] = ['minor', 'major', 'critical'];

/**
 * Worst first: severity, then what the principle is worth to *this* brief.
 *
 * Severity is the scorer's own opinion about how bad a fault is and stays the first key. The second
 * is what makes the repair stage read the brief without knowing it exists: two major faults are
 * equally bad in the abstract, and on an entertaining plan the one about how the spaces relate is
 * the one a designer fixes first. Absent weights fall back to zero, so a score from before the
 * weighting sorts exactly as it always did.
 *
 * Nothing else is added as a tiebreak. `Array.prototype.sort` is stable, so equal keys keep the
 * order the principles emitted them in — which is deterministic, and an alphabetical tiebreak over
 * codes would replace that with an order nobody chose.
 */
export function issuesBySeverity(score: DesignScore): DesignIssue[] {
  const worth = (issue: DesignIssue) => score.weights?.[issue.principle] ?? 0;

  return [...score.issues].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) ||
      worth(b) - worth(a),
  );
}
