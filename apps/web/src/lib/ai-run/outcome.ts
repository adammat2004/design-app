import type { DesignElement } from '@garden-studio/schema';
import type { ReviewOutcome, ReviewPass } from './review-loop';

/**
 * What the designer actually did, counted from the garden rather than from what it meant to do.
 *
 * This replaces `summarise`, which counted the **proposal** — so a request whose last two lines the
 * planner refused still reported four changes, and the one number on screen was the one number that
 * could not be checked. Everything here is measured against the elements before and after, which is
 * the same thing the user is looking at.
 *
 * **Elements changed, not operations performed**, and the difference is deliberate. One line of a
 * proposal can produce two operations (an outline morph and a material swap on the same bed), and
 * one operation can be played and then wound back by the reviewer. Neither is a change to the
 * garden. What the user counts when they look at the plan is how many things are different, so that
 * is what the sentence says.
 */
export interface AgentOutcome {
  /** How many elements are different, comparing the garden before the request with the garden now. */
  changed: number;
  /** Asked for and not done, with the reason whoever refused it gave. Never invented prose. */
  refused: { label: string; reason: string }[];
  /**
   * What the reviewer did afterwards. Null when it did not run.
   *
   * The passes are kept whole rather than reduced to two lists of sentences, because the panel
   * shows each fault with the scores either side of it — "the design scores 0.88, up from 0.85" is
   * the evidence for the claim, and a summary that dropped it would leave the reviewer asserting
   * an improvement nobody can check.
   */
  review: { passes: ReviewPass[]; verdict: ReviewOutcome['verdict'] } | null;
  /** Whether the user stopped it part way, which changes what the sentence promises. */
  stopped: boolean;
  /** The whole thing as one paragraph, which is what the transcript shows. */
  text: string;
}

export interface OutcomeInput {
  /** The garden before the request — the sentence's own starting point, not the last run's. */
  initial: DesignElement[];
  /** The garden now. */
  result: DesignElement[];
  /**
   * What could not be done.
   *
   * Two sources, deliberately merged: the run's prepare-time refusals (measured against the plan as
   * each operation would land on it) and the planner's `unplaceable` entries (measured before the
   * run existed at all). They are different information — a bed can be placeable when the planner
   * looks and refused by the time three earlier operations have moved the things around it — and
   * both are things the user asked for and did not get.
   */
  refused: { label: string; reason: string }[];
  review?: ReviewOutcome | null;
  stopped?: boolean;
}

/** How many elements differ. Identity, because every store action replaces rather than mutates. */
function changedCount(before: DesignElement[], after: DesignElement[]): number {
  const was = new Map(before.map((element) => [element.id, element]));
  let changed = after.filter((element) => was.get(element.id) !== element).length;
  for (const element of before) {
    if (!after.some((candidate) => candidate.id === element.id)) changed += 1;
  }
  return changed;
}

function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function composeOutcome(input: OutcomeInput): AgentOutcome {
  const changed = changedCount(input.initial, input.result);
  const stopped = input.stopped === true;

  const review = input.review
    ? { passes: input.review.passes, verdict: input.review.verdict }
    : null;

  const sentences: string[] = [];

  /*
   * The opening sentence is about what is on the plan, in every case.
   *
   * A stopped run says so first and then says what it kept, because "Stopped" on its own reads as
   * "nothing happened" — and Stop deliberately keeps the work that had landed. Getting that wrong
   * would have the user pressing Undo on a garden they wanted.
   */
  if (changed === 0) {
    sentences.push(
      stopped ? 'Stopped before anything changed.' : 'Nothing on the plan changed.',
    );
  } else if (stopped) {
    sentences.push(`Stopped part way — ${countOf(changed, 'change')} kept.`);
  } else {
    sentences.push(`Done. ${countOf(changed, 'change')}.`);
  }

  /*
   * What the reviewer did, said as one sentence per outcome rather than per fault.
   *
   * A pass that was played and wound back is still reported: the user watched it happen, and a
   * summary that only listed what survived would be pretending the rest never occurred.
   */
  if (review) {
    const kept = review.passes.filter((pass) => pass.kept).length;
    const putBack = review.passes.length - kept;

    if (kept > 0) sentences.push(`The reviewer also fixed ${countOf(kept, 'thing')}.`);
    if (putBack > 0) {
      sentences.push(
        `It tried ${countOf(putBack, 'other change', 'other changes')} and put ${
          putBack === 1 ? 'it' : 'them'
        } back: no measurable improvement.`,
      );
    }
    if (review.passes.length === 0 && !stopped) {
      sentences.push('The reviewer found nothing else to improve.');
    }
  }

  return {
    changed,
    refused: input.refused,
    review,
    stopped,
    text: sentences.join(' '),
  };
}
