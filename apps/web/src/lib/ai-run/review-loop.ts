import {
  issuesBySeverity,
  type PlanGeometry,
  type DesignElement,
  type DesignIntent,
  type DesignIssue,
  type DesignRun,
  type DesignScore,
  type ProposedChange,
} from '@garden-studio/schema';
import { runFromProposal } from './from-proposal';

/**
 * The reviewer looks at the finished garden, finds the worst thing it can actually fix, and fixes
 * it in front of you.
 *
 * The shape is taken wholesale from `repair.ts`, which does the same job inside the generator on
 * layout candidates: take the worst *repairable* fault, change the one thing the scorer named,
 * measure again, and **keep the result only if the score actually rose**. That gate is the whole
 * reason this is worth having rather than being a second generator with a different name — a
 * reviewer that always changes something is a reviewer whose opinion is worthless, and one that
 * can make a plan worse is actively harmful.
 *
 * Every dependency is injected, so the interesting half is testable with no server, no model, no
 * clock and no canvas — the same split `planner.service.test.ts` gets from taking `DesignIntent`
 * objects straight in. What is left in the store is plumbing.
 */

/** How much better it has to get to be worth keeping. The same threshold `repair.ts` uses. */
export const WORTHWHILE = 0.002;

/** Two passes. The third almost never helps and the user is watching all of it. */
export const MAX_PASSES = 2;

export interface ReviewPass {
  /** What the reviewer complained about, in its own measured words. */
  issue: DesignIssue;
  before: number;
  after: number;
  /** Whether the change was kept. False means it was played and then wound back. */
  kept: boolean;
}

export interface ReviewOutcome {
  passes: ReviewPass[];
  /** Why it stopped, for the panel to say out loud. */
  verdict: 'improved' | 'nothing-to-fix' | 'nothing-worked' | 'stopped';
  score: DesignScore | null;
}

export interface ReviewTools {
  /** The current plan, read fresh each time: a run has changed it since the last look. */
  elements: () => DesignElement[];
  score: (elements: DesignElement[]) => Promise<DesignScore>;
  /** Asks the planner for a diff, against the layout as it stands rather than as it was saved. */
  propose: (intents: DesignIntent[], elements: DesignElement[]) => Promise<ProposedChange[]>;
  /** Plays a run to the end. Resolves with what happened to it. */
  play: (run: DesignRun) => Promise<'complete' | 'cancelled' | 'refused'>;
  /** Puts the last run back, when the measurement says it was not worth keeping. */
  undo: () => void;
  maxPasses?: number;
}

/**
 * What the reviewer cannot perform, and why. Every one of these was decided by measurement.
 *
 * Stating the gap rather than hiding it behind a no-op is the same discipline `repair.ts` keeps
 * with its own `UNAVAILABLE` list: a limitation that is written down can be closed, and one that
 * looks like an action but silently achieves nothing is the "tick the design ignores" defect this
 * codebase keeps catching itself committing.
 */
export const UNPERFORMABLE: Partial<Record<NonNullable<DesignIssue['repair']>, string>> = {
  /*
   * **Measured, not assumed.** The scorer says "move this" and never says where to; the only
   * destinations an intent can name are the house, the boundary, or a zone the scorer did not
   * mention. Mapped to `towards: 'boundary'` across four generated fixtures, the planner refused
   * every single one with "It is already as far that way as it will go" — the things these faults
   * are about are against a fence already. Picking a zone instead would be inventing the
   * correction rather than performing it. What is actually needed is an intent that can say
   * "towards that other element", which does not exist.
   */
  'move-to-zone': 'the scorer says what is wrong but not where the thing should go instead',
  'move-destination': 'the scorer says what is wrong but not where the thing should go instead',
  'move-tree': 'the scorer says what is wrong but not where the thing should go instead',
  /* A rotation, which no intent expresses. */
  align: 'no intent can turn a thing',
  /* Different beds are the composition's business, not an edit to one element. */
  'merge-beds': 'redrawing the beds is the composition\'s decision, not an edit to one of them',
  /* Two coordinated reshapes — the thing `deepenBorder` had to be written by hand to do. */
  'enlarge-lawn': 'the lawn can only grow by taking ground from whatever is beside it',
  /* There is no reroute intent; the planner cannot yet redraw a route. */
  reroute: 'the planner has no way to redraw a route yet',
};

/**
 * A path narrow enough to complain about should come back wide enough to walk down.
 *
 * Not `MIN_ROUTE_WIDTH`: that constant lives in the scorer and is read off the narrowest route the
 * generator legitimately draws, so aiming at it lands exactly on the threshold and the next
 * rounding error puts the fault straight back. A metre is a path two people pass on.
 */
const COMFORTABLE_ROUTE = 1;

/**
 * What to do about a fault, in the planner's vocabulary.
 *
 * Three kinds, and only three. Each is a fault whose fix the scorer fully specifies — "it is too
 * big", "it is too narrow", "there is one thing too many" all say what to do as well as what is
 * wrong. Everything else is in `UNPERFORMABLE` above with its reason.
 *
 * **The elements are read, not just their ids.** A relative factor chosen without looking at the
 * thing is a guess: 1.3 on a path pinched to 0.5 m gives 0.65 m, which is still too narrow, so the
 * fault survives, the score does not move and the loop winds its own correction back. Measured —
 * that is precisely how the first version behaved, and it looked like a reviewer with nothing to
 * say rather than one aiming too low.
 */
export function intentsFor(issue: DesignIssue, elements: DesignElement[] = []): DesignIntent[] {
  const target = { elementIds: issue.subjects.slice(0, 8) };
  if (target.elementIds.length === 0) return [];

  switch (issue.repair) {
    case 'shrink-terrace':
      return [{ kind: 'resize', target, factor: 0.85 }];

    case 'widen-path': {
      const widths = target.elementIds
        .map((id) => elements.find((element) => element.id === id)?.shape)
        .filter((shape) => shape?.kind === 'polyline')
        .map((shape) => (shape as Extract<PlanGeometry, { kind: 'polyline' }>).width);

      const narrowest = widths.length > 0 ? Math.min(...widths) : 0;
      /* Clamped to what the intent will carry; 1.3 is the fallback when the width is unknown. */
      const factor = narrowest > 0 ? Math.min(4, Math.max(1.05, COMFORTABLE_ROUTE / narrowest)) : 1.3;
      return [{ kind: 'resize', target, factor }];
    }

    case 'drop-optional':
      return [{ kind: 'remove', target }];

    default:
      return [];
  }
}

/**
 * What identifies a fault for the purpose of not trying it twice.
 *
 * The code *and* what it is about. Keyed on the code alone, a plan with three pinched paths would
 * have one widened and the other two written off as already attempted — which is how the loop first
 * behaved, and it was visibly wrong the moment a plan had two of anything.
 */
export function issueKey(issue: DesignIssue): string {
  return `${issue.code}:${issue.subjects.join(',')}`;
}

/** The worst thing the reviewer can actually do something about. */
export function firstRepairable(
  score: DesignScore,
  tried: Set<string>,
  elements: DesignElement[] = [],
): DesignIssue | null {
  for (const issue of issuesBySeverity(score)) {
    if (tried.has(issueKey(issue))) continue;
    if (intentsFor(issue, elements).length === 0) continue;
    return issue;
  }
  return null;
}

export async function runReviewLoop(tools: ReviewTools): Promise<ReviewOutcome> {
  const limit = tools.maxPasses ?? MAX_PASSES;
  const passes: ReviewPass[] = [];
  const tried = new Set<string>();

  let score = await tools.score(tools.elements());

  for (let pass = 0; pass < limit; pass += 1) {
    /* Read fresh every pass: the run before this one has changed the garden. */
    const current = tools.elements();
    const issue = firstRepairable(score, tried, current);
    if (!issue) break;
    tried.add(issueKey(issue));

    const changes = await tools.propose(intentsFor(issue, current), current);
    if (changes.length === 0) continue;

    const run = runFromProposal(changes, issue.message, `review-${pass}`, {
      agent: 'reviewer',
      phase: 'review',
    });
    if (!run) continue;

    const played = await tools.play(run);
    if (played === 'refused') continue;
    if (played === 'cancelled') return { passes, verdict: 'stopped', score };

    const before = score;
    const after = await tools.score(tools.elements());
    const kept = after.total > before.total + WORTHWHILE && !worseCriticals(before, after);

    /*
     * Wound back rather than kept, when the measurement does not support it. The change was played
     * either way — the user has already watched the reviewer try something — and saying "that did
     * not help" while leaving it in place would be the reviewer marking its own homework.
     */
    if (kept) score = after;
    else tools.undo();

    passes.push({ issue, before: before.total, after: after.total, kept });
  }

  if (passes.length === 0) return { passes, verdict: 'nothing-to-fix', score };
  return {
    passes,
    verdict: passes.some((entry) => entry.kept) ? 'improved' : 'nothing-worked',
    score,
  };
}

/** A repair that trades a minor fault for a critical one is not a repair. */
function worseCriticals(before: DesignScore, after: DesignScore): boolean {
  const count = (score: DesignScore) =>
    score.issues.filter((issue) => issue.severity === 'critical').length;
  return count(after) > count(before);
}
