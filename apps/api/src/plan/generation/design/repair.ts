import {
  issuesBySeverity,
  tierOf,
  type DesignBrief,
  type DesiredFeature,
  type DesignIssue,
  type DesignScore,
  type RepairKind,
} from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import { GOOD_ENOUGH } from '../knowledge/principles.js';
import { elementsFromPreview } from './adapters.js';
import type { Candidate, EnumerateRequest } from './candidates.js';
import { evaluateDesign } from './evaluate/index.js';
import { previewLayout, type LayoutPreview, type PlacedItem } from './layout-generator.js';
import { NO_ADJUSTMENTS, type CandidateParams, type LayoutAdjustments } from './types.js';

/**
 * Making a chosen layout better, rather than passing it over.
 *
 * The candidate loop could only ever *choose*. A layout with one fixable fault — a store standing in
 * the sightline out of the doors, a path pinching past a bed, a barbecue at the wrong end of the
 * terrace — was ranked below one without it and forgotten, which is the right answer only when a
 * better arrangement happens to exist in the field. On most plots it does not: the fault is in the
 * best plan the plot supports, and the designer's move is to fix that one thing.
 *
 * ```
 *   score ─→ worst issue carrying a repair hint
 *              │
 *              ├─ apply           a targeted change aimed at that issue's own subjects
 *              ├─ re-preview      the whole layout redrawn, not patched
 *              ├─ re-score        the same nine principles
 *              └─ accept only if the total rose and nothing critical appeared
 * ```
 *
 * Four properties hold it together, and each is a mistake avoided rather than a preference.
 *
 * **A repair is targeted, never a parameter sweep.** Every value of every `CandidateParams` axis is
 * already enumerated, previewed and scored, so a "repair" that moved a parameter would be searching
 * a space the loop has exhausted and could not find anything it had not already rejected. What is
 * new here is acting on a *subject the scorer named* — move this feature, re-approach this path,
 * leave this thing out — which no enumeration can reach because it depends on the measurement.
 *
 * **The whole layout is redrawn, never patched.** Moving the store changes what the paths can do,
 * what the beds are left with and where the trees fit. Editing the placed result in situ would
 * produce an arrangement no generator could have drawn, and the realised plan would then differ
 * from the thing that was scored.
 *
 * **A repair is accepted only on a measured improvement**, on the same scorer that found the fault.
 * It can therefore never make a plan worse: at the limit it does nothing and the original stands.
 *
 * **What is accepted is carried into realisation.** `LayoutAdjustments` is honoured by
 * `concepts.service.ts` as well as by the preview. A repair the real pipeline ignored would be a
 * score claiming an improvement the garden does not have, which is worse than the fault it hid.
 */

/**
 * How many repairs to attempt on one candidate.
 *
 * Each costs a preview and a score — a millisecond or so — and it runs three times per generation,
 * once per slot. The bound is about behaviour rather than cost: past about four changes a layout is
 * no longer the candidate that was chosen for its composition, and a loop that kept going would
 * quietly turn the diversity filter's three distinct answers into three converged ones.
 */
const BUDGET = 4;

/** Below this much improvement a change is noise on a weighted mean of nine numbers. */
const WORTHWHILE = 0.002;

/**
 * The two repair kinds nothing here can perform, and why — stated rather than silently missing.
 *
 * `align` is a rotation fault. Every placement a composition makes inherits the frame's own bearing
 * through `fitInSlot`, so `misaligned` can only ever be raised against something the PostGIS sampler
 * placed at realisation, and no adjustment to a candidate reaches it. The fix belongs in the sampler.
 *
 * `merge-beds` asks for different beds. Beds come from the composition's own sketch, so a repair
 * that redrew them would be rewriting the archetype rather than adjusting this candidate of it —
 * and the archetype is the thing the user is being offered a choice between.
 */
export const UNAVAILABLE: Partial<Record<RepairKind, string>> = {
  align: 'rotation is set by the frame, so only a sampled placement can be out of true',
  'merge-beds': "the beds are the composition's, not this candidate's",
};

export interface RepairRequest {
  candidate: Candidate;
  score: DesignScore;
  analysis: EnumerateRequest['analysis'];
  context: EnumerateRequest['context'];
}

export interface RepairResult {
  /** The candidate as it stands after repair: the original when nothing was accepted. */
  candidate: Candidate;
  score: DesignScore;
  adjustments: LayoutAdjustments;
  /** What was changed, in the order it was changed, as sentences a person reads. */
  repairs: string[];
  /** How many changes were attempted, accepted or not. Reported by the harness. */
  attempted: number;
}

/**
 * Off with `DESIGN_REPAIR=0`, which exists for the harness rather than for production.
 *
 * Two changes landed together — the repair loop and the realisation alignment that made the preview
 * and the built plan place features in the same order — and a benchmark that cannot separate two
 * changes cannot attribute either. The gate is what let each be measured on its own.
 */
const ENABLED = process.env.DESIGN_REPAIR !== '0';

export function repairCandidate(request: RepairRequest): RepairResult {
  let candidate = request.candidate;
  let score = request.score;
  let adjustments = NO_ADJUSTMENTS;

  if (!ENABLED) {
    return { candidate, score, adjustments, repairs: [], attempted: 0 };
  }

  const repairs: string[] = [];
  /* An operation is tried once. Without this the same worst issue is answered the same way forever. */
  const tried = new Set<string>();
  let attempted = 0;

  for (let step = 0; step < BUDGET; step += 1) {
    if (score.total >= GOOD_ENOUGH) break;

    const next = nextOperation(score, candidate, adjustments, tried);
    if (!next) break;

    tried.add(next.key);
    attempted += 1;

    const preview = previewLayout({
      ...request.context,
      archetype: candidate.fit.archetype,
      params: next.params,
      brief: candidate.brief,
      analysis: request.analysis,
      adjustments: next.adjustments,
    });

    /*
     * Checked before the score is even computed, because this is not a question about quality: a
     * preview that lost a feature is not a worse arrangement of the garden, it is a different and
     * smaller garden, and the score would read the absence as an improvement.
     */
    if (!keepsWhatItPlaced(candidate.preview, preview, next)) continue;

    const { elements, featureOf } = elementsFromPreview(preview, request.context.zoneAt);
    const scored = evaluateDesign({
      elements,
      analysis: request.analysis,
      brief: candidate.brief,
      featureOf,
      tier: 'structural',
    });

    /*
     * The gate, and it is deliberately strict in both directions. A change that only holds the score
     * level is not an improvement — it is a different plan with the same faults, and taking it would
     * let the loop wander.
     *
     * The critical test is *relative*, not absolute. A candidate can arrive carrying one: the
     * selector drops critical-faulted candidates before it picks, but on a plot where that would
     * empty the field it picks one anyway, and refusing every repair to a plan that already has the
     * fault would abandon exactly the plan that most needs helping. What is forbidden is adding one,
     * because a critical is a plan that cannot be offered rather than a worse one.
     */
    if (scored.total <= score.total + WORTHWHILE) continue;
    if (criticals(scored) > criticals(score)) continue;

    candidate = { ...candidate, params: next.params, preview };
    score = scored;
    adjustments = next.adjustments;
    repairs.push(next.text);
  }

  return { candidate, score, adjustments, repairs, attempted };
}

/* ---------------------------------------------------------------- choosing what to try */

interface Operation {
  /** Identifies the attempt, so the loop cannot answer one issue the same way twice. */
  key: string;
  params: CandidateParams;
  adjustments: LayoutAdjustments;
  /** A designer's sentence: what was changed and what it was for. */
  text: string;
  /** The one feature this operation means to remove. Only `drop-optional` ever sets it. */
  drops?: DesiredFeature;
}

/**
 * Did the repair move the thing, or did it lose it?
 *
 * **The benchmark found this, and it is the sharpest lesson of the repair stage.** Barring the slot
 * a store was in asks the fitter for its second answer — but when there is no second answer the
 * store simply goes unplaced, and a preview with no store in it has no store standing in the
 * sightline either. The relationship score rises, the loop accepts, and the real pipeline then hands
 * the store to the PostGIS sampler, which puts it back in the garden with none of the composition's
 * reasoning. On the long-narrow fixture that turned a plan scoring 0.83 into one scoring 0.72 while
 * every structural number said it had improved.
 *
 * So a repair may not quietly shrink the garden. The one operation that means to remove something
 * declares it, and nothing else is allowed to.
 */
/** How many faults in this score make the plan unofferable. */
function criticals(score: DesignScore): number {
  return score.issues.filter((issue) => issue.severity === 'critical').length;
}

function keepsWhatItPlaced(
  before: LayoutPreview,
  after: LayoutPreview,
  operation: Operation,
): boolean {
  const seated = new Set(after.placed.map((item) => item.feature));
  return before.placed.every(
    (item) => seated.has(item.feature) || item.feature === operation.drops,
  );
}

/**
 * The worst issue this loop can still do something about, turned into a change to try.
 *
 * Worst-first, because severity is the scorer's own opinion about what matters and re-deriving an
 * order here would be a second one to disagree with. An issue whose repair is unavailable, already
 * tried, or which the plot does not let this operation move is skipped rather than abandoning the
 * loop — there are usually several faults and the second is often the tractable one.
 */
function nextOperation(
  score: DesignScore,
  candidate: Candidate,
  adjustments: LayoutAdjustments,
  tried: Set<string>,
): Operation | null {
  for (const issue of issuesBySeverity(score)) {
    if (!issue.repair || UNAVAILABLE[issue.repair]) continue;
    const operation = build(issue, issue.repair, candidate, adjustments);
    if (operation && !tried.has(operation.key)) return operation;
  }
  return null;
}

function build(
  issue: DesignIssue,
  kind: RepairKind,
  candidate: Candidate,
  adjustments: LayoutAdjustments,
): Operation | null {
  const { preview, params, brief } = candidate;
  switch (kind) {
    case 'shrink-terrace':
      return shrinkTerrace(params, adjustments);
    case 'enlarge-lawn':
      return enlargeLawn(params, adjustments);
    case 'move-destination':
      return moveDestination(params, adjustments);
    case 'drop-optional':
      return dropOptional(issue, preview, params, adjustments, brief);
    case 'move-to-zone':
      return moveToZone(issue, preview, params, adjustments);
    case 'reroute':
      return reroute(issue, preview, params, adjustments);
    case 'widen-path':
      return widenPath(params, adjustments);
    case 'move-tree':
      return moveTree(preview, params, adjustments);
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- the operations */

/** The steps `terraceDepth` may take, shallowest first. */
const TERRACE_STEPS: CandidateParams['terraceDepth'][] = [0.85, 1, 1.15];

function shrinkTerrace(params: CandidateParams, adjustments: LayoutAdjustments): Operation | null {
  const index = TERRACE_STEPS.indexOf(params.terraceDepth);
  if (index <= 0) return null;
  const terraceDepth = TERRACE_STEPS[index - 1]!;
  return {
    key: `shrink-terrace:${terraceDepth}`,
    params: { ...params, terraceDepth },
    adjustments,
    text: 'Narrowed the terrace, to leave the open ground behind it worth having.',
  };
}

/**
 * More open ground, by whichever lever this candidate has left.
 *
 * A shallower terrace first, because the terrace is what usually took the depth; then the panel to
 * the other side of the garden, which is what a bias is for. Both are parameters — the one case
 * where a repair reaches for one, and it is honest here because the issue names the *panel* rather
 * than a subject an adjustment could move.
 */
function enlargeLawn(params: CandidateParams, adjustments: LayoutAdjustments): Operation | null {
  const shrunk = shrinkTerrace(params, adjustments);
  if (shrunk) {
    return {
      ...shrunk,
      key: `enlarge-lawn:${shrunk.key}`,
      text: 'Took depth off the terrace to give the lawn a usable panel.',
    };
  }

  const order: CandidateParams['lawnBias'][] = ['centre', 'away', 'gate'];
  const next = order.find((bias) => bias !== params.lawnBias);
  if (!next) return null;
  return {
    key: `enlarge-lawn:bias:${next}`,
    params: { ...params, lawnBias: next },
    adjustments,
    text: 'Moved the open panel across the garden, so it reads as one lawn rather than two strips.',
  };
}

function moveDestination(
  params: CandidateParams,
  adjustments: LayoutAdjustments,
): Operation | null {
  const order: CandidateParams['destination'][] = ['far-diagonal', 'far-centre', 'axis-end'];
  const index = order.indexOf(params.destination);
  const next = order[(index + 1) % order.length]!;
  if (next === params.destination) return null;
  return {
    key: `move-destination:${next}`,
    params: { ...params, destination: next },
    adjustments,
    text: 'Moved the far room, so the view out of the doors lands on something.',
  };
}

/**
 * Leave out the least important thing the issue is about.
 *
 * Only ever an `optional` feature, and the tier is read from the same table the capacity cut uses —
 * dropping something the brief called essential to raise a score is the scorer optimising against
 * the user, which is the one thing it must never do.
 */
function dropOptional(
  issue: DesignIssue,
  preview: LayoutPreview,
  params: CandidateParams,
  adjustments: LayoutAdjustments,
  brief: DesignBrief,
): Operation | null {
  const candidates = subjectsOf(issue, preview)
    .map((item) => item.feature)
    .filter((feature) => !adjustments.dropped.includes(feature));

  const feature = candidates.find((candidate) => tierOf(brief, candidate) === 'optional');
  if (!feature) return null;

  return {
    key: `drop-optional:${feature}`,
    params,
    adjustments: { ...adjustments, dropped: [...adjustments.dropped, feature] },
    text: `Left out the ${FEATURE_LIBRARY[feature].spec.planName?.toLowerCase() ?? feature}: there was no room for it that did not spoil something else.`,
    drops: feature,
  };
}

/**
 * Ask the fitter for its second answer about where one feature goes.
 *
 * Barring the slot it chose is the whole mechanism, and it works because the fitter is first-fit
 * over an ordered ladder: take the rung it landed on away and it takes the next, which is exactly
 * "put it somewhere else sensible" without teaching the fitter to rank. The feature genuinely may
 * end up unplaced, and that is a legitimate outcome the score then judges.
 */
function moveToZone(
  issue: DesignIssue,
  preview: LayoutPreview,
  params: CandidateParams,
  adjustments: LayoutAdjustments,
): Operation | null {
  const item = subjectsOf(issue, preview).find(
    (candidate) =>
      candidate.slotId !== 'terrace' &&
      !adjustments.avoidSlots.some(
        (entry) => entry.feature === candidate.feature && entry.slot === candidate.slotId,
      ),
  );
  /*
   * The terrace is excluded on purpose. It goes across the garden doors because that is what a
   * terrace is; a repair that moved it to raise a sun or a privacy score would be answering a real
   * fault by drawing a garden you step out of onto grass.
   */
  if (!item) return null;

  return {
    key: `move-to-zone:${item.feature}:${item.slotId}`,
    params,
    adjustments: {
      ...adjustments,
      avoidSlots: [...adjustments.avoidSlots, { feature: item.feature, slot: item.slotId }],
    },
    text: `Moved the ${item.name.toLowerCase()} out of ${describeSlot(item.slotId)}. ${issue.message}`,
  };
}

/** Take the next approach to the path the scorer complained about. */
function reroute(
  issue: DesignIssue,
  preview: LayoutPreview,
  params: CandidateParams,
  adjustments: LayoutAdjustments,
): Operation | null {
  const route = preview.routes.find((candidate) => issue.subjects.includes(candidate.id));
  if (!route) return null;

  const already = adjustments.reroute[route.name] ?? 0;
  if (already >= 2) return null;

  return {
    key: `reroute:${route.name}:${already + 1}`,
    params,
    adjustments: { ...adjustments, reroute: { ...adjustments.reroute, [route.name]: already + 1 } },
    text: `Ran the ${route.name.toLowerCase()} a different way round. ${issue.message}`,
  };
}

/** How much a narrow path is widened by, in metres. One step is the difference a person feels. */
const WIDEN_STEP = 0.3;

/** The widest a repair will make a garden path: past this it is a drive. */
const WIDEST_PATH = 1.8;

function widenPath(params: CandidateParams, adjustments: LayoutAdjustments): Operation | null {
  const width = (adjustments.routeWidth ?? 0.9) + WIDEN_STEP;
  if (width > WIDEST_PATH) return null;
  return {
    key: `widen-path:${width.toFixed(2)}`,
    params,
    adjustments: { ...adjustments, routeWidth: width },
    text: `Widened the paths to ${width.toFixed(1)} m, so two people can pass on them.`,
  };
}

function moveTree(
  preview: LayoutPreview,
  params: CandidateParams,
  adjustments: LayoutAdjustments,
): Operation | null {
  if (preview.trees.length === 0 || adjustments.treeNudge >= 3) return null;
  return {
    key: `move-tree:${adjustments.treeNudge + 1}`,
    params,
    adjustments: { ...adjustments, treeNudge: adjustments.treeNudge + 1 },
    text: 'Stood the trees a little further off, to keep the view out of the doors open.',
  };
}

/* ---------------------------------------------------------------- helpers */

/**
 * The placed items an issue is about.
 *
 * Issues name element ids, and a preview's element ids *are* its placed items' ids — which is what
 * `elementsFromPreview` guarantees and what makes an issue actionable rather than merely readable.
 * An issue about a bed, a route or the panel resolves to nothing here, which is the honest answer:
 * those are not things a placement repair can move.
 */
function subjectsOf(issue: DesignIssue, preview: LayoutPreview): PlacedItem[] {
  return preview.placed.filter((item) => issue.subjects.includes(item.id));
}

function describeSlot(slot: string): string {
  if (slot.includes('utility')) return 'the utility corner';
  if (slot.includes('terrace')) return 'the terrace';
  if (slot.includes('lawn')) return 'the lawn';
  if (slot.includes('far')) return 'the far end';
  return 'where it was';
}
