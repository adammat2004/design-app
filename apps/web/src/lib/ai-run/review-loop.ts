import {
  issuesBySeverity,
  performableInEditor,
  type DesignElement,
  type DesignIssue,
  type DesignRun,
  type DesignScore,
  type RepairDesignResult,
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
 * **The search moved to the server, and that is the change worth understanding.** This loop used to
 * map a fault to one intent, take whatever the planner's first legal step was, *animate* it, and
 * only then measure — so about half the time the user watched the designer do something that a
 * measurement taken beforehand would have ruled out. `POST /design/repair` scores several
 * corrections against the real plan and answers with the best one, or with nothing and a reason. A
 * change that helps nothing is now never played at all.
 *
 * The editor is still the authority on what landed: the run is played and the plan re-scored, and
 * the server's prediction is a claim this loop checks rather than one it trusts.
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
  /**
   * Whether anything was animated at all.
   *
   * False where the server found nothing worth doing, which is the pass the old loop could not
   * have: it had no way to know a correction was pointless without performing it first.
   */
  played: boolean;
  /** How many corrections the server scored. Narrated, so it has to be the real count. */
  considered: number;
  /** Why nothing was done, in the planner's own words. Null when something was. */
  reason: string | null;
}

/**
 * A fault the reviewer could fix but did not, because it is not what the user asked about.
 *
 * The offer is the answer to the question a scoped reviewer otherwise raises: "it found something
 * wrong and said nothing?" It carries only the issue now: what to do about it is the server's to
 * work out, and working it out twice — once to offer and once to accept — would be two searches for
 * one decision, against a plan that may have changed in between.
 */
export interface ReviewOffer {
  issue: DesignIssue;
}

export interface ReviewOutcome {
  passes: ReviewPass[];
  /** Why it stopped, for the panel to say out loud. */
  verdict: 'improved' | 'nothing-to-fix' | 'nothing-worked' | 'stopped';
  score: DesignScore | null;
  /** Actionable faults outside the scope of this review, offered rather than performed. */
  offers: ReviewOffer[];
}

export interface ReviewTools {
  /** The current plan, read fresh each time: a run has changed it since the last look. */
  elements: () => DesignElement[];
  score: (elements: DesignElement[]) => Promise<DesignScore>;
  /** Asks the server for the best correction to one fault, measured against the plan as it stands. */
  repair: (issue: DesignIssue, elements: DesignElement[]) => Promise<RepairDesignResult>;
  /** Plays a run to the end. Resolves with what happened to it. */
  play: (run: DesignRun) => Promise<'complete' | 'cancelled' | 'refused'>;
  /** Puts the last run back, when the measurement says it was not worth keeping. */
  undo: () => void;
  /**
   * What the reviewer is doing, as it does it.
   *
   * Every string this is called with is read off something that was actually measured — the fault's
   * own sentence, the count of corrections scored, the element being changed. A narration that
   * described a step the code does not take would be the agent chatter this panel exists without.
   */
  narrate?: (status: string | null) => void;
  maxPasses?: number;
  /**
   * The element ids the request actually touched, or absent for the whole plan.
   *
   * A reviewer that follows a request has to stay near it. Asking for a bigger terrace and watching
   * the designer go on to move the store and rewrite the lighting is the moment the user stops
   * feeling they are driving — it reads as the tool taking over rather than answering. So a scoped
   * pass fixes only faults about what it just changed, and everything else it found comes back as
   * an offer for the user to accept or ignore.
   *
   * "Review my design", asked on its own, passes nothing and the whole plan is in scope.
   */
  subjects?: string[];
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

/**
 * Whether a fault is about something this review is allowed to touch.
 *
 * Any overlap counts, not every subject: a pinched path between the terrace the user just enlarged
 * and a bed they never mentioned is a fault their own request caused, and refusing it on the
 * grounds that the bed is out of scope would leave the reviewer unable to clean up after the change
 * it just made.
 */
function inScope(issue: DesignIssue, subjects: string[] | undefined): boolean {
  if (!subjects) return true;
  return issue.subjects.some((subject) => subjects.includes(subject));
}

/**
 * Whether this fault is one the editor's planner can carry out at all.
 *
 * `REPAIR_CAPABILITIES` in the schema is the one table now. There used to be three — one here, one
 * in the generator's repair stage, and a third expressed as the set of branches somebody had
 * remembered to write in `intentsFor` — and a repair kind was performable if and only if all three
 * happened to agree.
 */
function actionable(issue: DesignIssue, elements: DesignElement[]): boolean {
  if (!performableInEditor(issue.repair)) return false;
  /*
   * And it has to name something. `DesignIssue.subjects` is documented as "element ids where they
   * exist, else zone ids or feature names", so a fault about "the back garden" resolves to nothing
   * the planner can change — and an offer for it would be a chip that does nothing, which is worse
   * than an absent one because the user has to press it to find out.
   */
  return issue.subjects.some((subject) => elements.some((element) => element.id === subject));
}

/** The worst thing the reviewer can actually do something about, inside its scope. */
export function firstRepairable(
  score: DesignScore,
  tried: Set<string>,
  elements: DesignElement[] = [],
  subjects?: string[],
): DesignIssue | null {
  for (const issue of issuesBySeverity(score)) {
    if (tried.has(issueKey(issue))) continue;
    if (!inScope(issue, subjects)) continue;
    if (!actionable(issue, elements)) continue;
    return issue;
  }
  return null;
}

/** What it found and chose not to touch, worth offering. */
export function offersFrom(
  score: DesignScore,
  tried: Set<string>,
  elements: DesignElement[],
  subjects: string[] | undefined,
  limit = 3,
): ReviewOffer[] {
  if (!subjects) return [];

  const offers: ReviewOffer[] = [];
  for (const issue of issuesBySeverity(score)) {
    if (offers.length >= limit) break;
    if (tried.has(issueKey(issue))) continue;
    if (inScope(issue, subjects)) continue;
    if (!actionable(issue, elements)) continue;

    offers.push({ issue });
  }
  return offers;
}

export async function runReviewLoop(tools: ReviewTools): Promise<ReviewOutcome> {
  const limit = tools.maxPasses ?? MAX_PASSES;
  const passes: ReviewPass[] = [];
  const tried = new Set<string>();
  const say = (status: string | null) => tools.narrate?.(status);

  /*
   * The whole element list every time, even when the pass is scoped.
   *
   * The scorer judges the *composition* — how things relate, what is in the sightline, whether the
   * planting reads as one garden — so handing it a subset would silently change what it is scoring
   * rather than narrowing what it reports. Scope decides what the reviewer may act on, never what
   * it may look at.
   */
  say('Checking the composition');
  let score = await tools.score(tools.elements());

  for (let pass = 0; pass < limit; pass += 1) {
    /* Read fresh every pass: the run before this one has changed the garden. */
    const current = tools.elements();
    const issue = firstRepairable(score, tried, current, tools.subjects);
    if (!issue) break;
    tried.add(issueKey(issue));

    say(issue.message);
    const repair = await tools.repair(issue, current);

    /*
     * Nothing worth doing, so nothing is done — and this is the pass the old loop could not have.
     * It had no way to know a correction was pointless without performing it, so the user watched
     * the designer try something and put it back about half the time.
     */
    if (repair.changes.length === 0) {
      passes.push({
        issue,
        before: score.total,
        after: score.total,
        kept: false,
        played: false,
        considered: repair.considered,
        reason: repair.reason,
      });
      continue;
    }

    say(testedSentence(repair));
    const run = runFromProposal(repair.changes, issue.message, `review-${pass}`, {
      agent: 'reviewer',
      phase: 'review',
    });
    if (!run) continue;

    const played = await tools.play(run);
    if (played === 'refused') continue;
    if (played === 'cancelled') {
      say(null);
      return { passes, verdict: 'stopped', score, offers: [] };
    }

    const before = score;
    const after = await tools.score(tools.elements());
    const kept = after.total > before.total + WORTHWHILE && !worseCriticals(before, after);

    /*
     * Wound back rather than kept, when the measurement does not support it. The server predicted
     * this would help and the editor is the authority on whether it did — the two can honestly
     * disagree, because the plan the prediction was made against is not always the plan the run
     * landed on.
     */
    if (kept) score = after;
    else tools.undo();

    passes.push({
      issue,
      before: before.total,
      after: after.total,
      kept,
      played: true,
      considered: repair.considered,
      reason: null,
    });
  }

  say(null);
  const offers = offersFrom(score, tried, tools.elements(), tools.subjects);

  if (passes.length === 0) return { passes, verdict: 'nothing-to-fix', score, offers };
  return {
    passes,
    verdict: passes.some((entry) => entry.kept) ? 'improved' : 'nothing-worked',
    score,
    offers,
  };
}

/** How hard the server looked, said out loud. The count is the one it actually scored. */
function testedSentence(repair: RepairDesignResult): string {
  if (repair.considered <= 1) return 'Testing a correction';
  return `Testing ${repair.considered} corrections`;
}

/** A repair that trades a minor fault for a critical one is not a repair. */
function worseCriticals(before: DesignScore, after: DesignScore): boolean {
  const count = (score: DesignScore) =>
    score.issues.filter((issue) => issue.severity === 'critical').length;
  return count(after) > count(before);
}
