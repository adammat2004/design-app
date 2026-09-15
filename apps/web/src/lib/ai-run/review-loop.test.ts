import { describe, expect, it, vi } from 'vitest';
import type { DesignElement, DesignIssue, DesignScore, ProposedChange } from '@garden-studio/schema';
import {
  UNPERFORMABLE,
  firstRepairable,
  intentsFor,
  issueKey,
  runReviewLoop,
  type ReviewTools,
} from './review-loop';

/**
 * The loop, with the server, the scorer and the canvas all faked.
 *
 * Which leaves exactly the thing worth testing: the gate. A reviewer that keeps every change it
 * tries is a reviewer with no opinion, and one that can leave a garden worse than it found it is
 * worse than none at all.
 */

function issue(over: Partial<DesignIssue> = {}): DesignIssue {
  return {
    code: 'route-too-narrow',
    principle: 'circulation',
    severity: 'major',
    message: 'The path to the store is 0.5 m wide.',
    subjects: ['e-7'],
    repair: 'widen-path',
    ...over,
  } as DesignIssue;
}

function score(total: number, issues: DesignIssue[] = [issue()]): DesignScore {
  return { total, categories: {}, issues, tier: 'realised' } as DesignScore;
}

const ELEMENT: DesignElement = {
  id: 'e-7',
  category: 'structure',
  role: 'feature',
  name: 'Garden store',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 4, y: 4 }, width: 2, depth: 2, rotation: 0 },
} as DesignElement;

function change(): ProposedChange {
  return {
    id: 'ch1',
    kind: 'move',
    elementId: 'e-7',
    label: 'Garden store',
    before: 'in the middle',
    after: 'against the fence',
    previous: ELEMENT,
    next: { ...ELEMENT, shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 2, depth: 2, rotation: 0 } },
  } as ProposedChange;
}

/** A loop with everything faked, and scores handed out in the order the test wants them. */
function harness(totals: number[], over: Partial<ReviewTools> = {}) {
  const undo = vi.fn();
  const play = vi.fn(async () => 'complete' as const);
  const propose = vi.fn(async () => [change()]);
  let call = 0;

  const tools: ReviewTools = {
    elements: () => [ELEMENT],
    score: vi.fn(async () => score(totals[Math.min(call++, totals.length - 1)]!)),
    propose,
    play,
    undo,
    ...over,
  };
  return { tools, undo, play, propose };
}

describe('what the reviewer can act on', () => {
  it('turns a fault it can fix into the planner\'s own vocabulary', () => {
    expect(intentsFor(issue({ repair: 'shrink-terrace' }))).toEqual([
      { kind: 'resize', target: { elementIds: ['e-7'] }, factor: 0.85 },
    ]);
    expect(intentsFor(issue({ repair: 'drop-optional' }))).toEqual([
      { kind: 'remove', target: { elementIds: ['e-7'] } },
    ]);
  });

  it('says nothing about the faults no intent expresses, and states why for each', () => {
    /*
     * Stated rather than silently doing nothing. The three move kinds are the ones measurement put
     * here: mapped to "towards the boundary" across four generated fixtures, the planner refused
     * every one with "It is already as far that way as it will go" — the scorer says what is wrong
     * and never where the thing should go instead.
     */
    for (const repair of ['align', 'merge-beds', 'enlarge-lawn', 'reroute',
      'move-to-zone', 'move-destination', 'move-tree'] as const) {
      expect(intentsFor(issue({ repair }))).toEqual([]);
      expect(UNPERFORMABLE[repair]).toBeTruthy();
    }
  });

  it('performs exactly the faults whose fix the scorer fully specifies', () => {
    for (const repair of ['shrink-terrace', 'widen-path', 'drop-optional'] as const) {
      expect(intentsFor(issue({ repair })).length).toBe(1);
      expect(UNPERFORMABLE[repair]).toBeUndefined();
    }
  });

  it('widens a pinched path enough to actually clear the fault', () => {
    /*
     * Measured. A flat 1.3 on a path pinched to 0.5 m gives 0.65 m, which is still too narrow — so
     * the fault survived, the score did not move, and the loop wound back its own correction. It
     * looked like a reviewer with nothing to say rather than one aiming too low.
     */
    const path: DesignElement = {
      id: 'e-7', category: 'paved-area', role: 'feature', zone: 'back',
      shape: { kind: 'polyline', width: 0.5, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    } as DesignElement;

    const [intent] = intentsFor(issue({ repair: 'widen-path' }), [path]);

    expect(intent).toMatchObject({ kind: 'resize', factor: 2 });
    // 0.5 x 2 is a metre: a path two people pass on, not one a rounding error re-breaks.
    expect(0.5 * (intent as { factor: number }).factor).toBeCloseTo(1, 6);
  });

  it('falls back to a modest widening when it cannot see the path', () => {
    expect(intentsFor(issue({ repair: 'widen-path' }))).toEqual([
      { kind: 'resize', target: { elementIds: ['e-7'] }, factor: 1.3 },
    ]);
  });

  it('ignores a fault that names nothing it could act on', () => {
    // Issues may name a zone or a feature rather than an element; those cannot become an intent.
    expect(intentsFor(issue({ subjects: [] }))).toEqual([]);
  });

  it('takes the worst fault first', () => {
    const worst = issue({ code: 'terrace-oversized', severity: 'critical', repair: 'shrink-terrace' });
    const lesser = issue({ severity: 'minor' });
    const both = score(0.7, [lesser, worst]);

    expect(firstRepairable(both, new Set())?.code).toBe('terrace-oversized');
    expect(firstRepairable(both, new Set([issueKey(worst)]))?.code).toBe('route-too-narrow');
  });

  it('tells two faults of the same kind apart', () => {
    /*
     * Three pinched paths are three things to fix. Keyed on the code alone the loop widened one and
     * wrote the others off as already tried, which is what it did before this was a test.
     */
    const first = issue({ subjects: ['e-7'] });
    const second = issue({ subjects: ['e-9'] });
    const both = score(0.7, [first, second]);

    expect(firstRepairable(both, new Set([issueKey(first)]))?.subjects).toEqual(['e-9']);
    expect(firstRepairable(both, new Set([issueKey(first), issueKey(second)]))).toBeNull();
  });

  it('skips a fault it has no intent for rather than stalling on it', () => {
    const unfixable = issue({ code: 'misaligned', severity: 'critical', repair: 'align' });
    const fixable = issue({ severity: 'minor' });

    expect(firstRepairable(score(0.7, [unfixable, fixable]), new Set())?.code).toBe('route-too-narrow');
  });
});

describe('the loop', () => {
  it('keeps a change that measurably improved the plan', async () => {
    const { tools, undo } = harness([0.70, 0.80, 0.80]);
    const outcome = await runReviewLoop(tools);

    expect(outcome.verdict).toBe('improved');
    expect(outcome.passes[0]).toMatchObject({ before: 0.7, after: 0.8, kept: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('winds back a change that did not', async () => {
    const { tools, undo } = harness([0.80, 0.79]);
    const outcome = await runReviewLoop(tools);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(outcome.passes[0]!.kept).toBe(false);
    expect(outcome.verdict).toBe('nothing-worked');
  });

  it('winds back a change that barely moved the number', async () => {
    // The same threshold the generator's own repair stage uses: 0.002.
    const { tools, undo } = harness([0.8, 0.8005]);
    await runReviewLoop(tools);

    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('winds back a change that swapped a minor fault for a critical one', async () => {
    let call = 0;
    const scores = [
      score(0.7, [issue()]),
      score(0.9, [issue({ severity: 'critical', code: 'route-missing' })]),
    ];
    const { tools, undo } = harness([0], {
      score: vi.fn(async () => scores[Math.min(call++, scores.length - 1)]!),
    });

    await runReviewLoop(tools);

    // Higher total, worse garden. A score is not the only thing that matters about a plan.
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('stops after two passes however many faults are left', async () => {
    let call = 0;
    const many = [
      issue({ subjects: ['e-1'] }),
      issue({ subjects: ['e-2'] }),
      issue({ code: 'terrace-oversized', repair: 'shrink-terrace' }),
    ];
    const { tools, play } = harness([0], {
      score: vi.fn(async () => score(0.5 + call++ * 0.1, many)),
    });

    const outcome = await runReviewLoop(tools);

    expect(play).toHaveBeenCalledTimes(2);
    expect(outcome.passes).toHaveLength(2);
  });

  it('does nothing at all to a plan it has no complaint about', async () => {
    const { tools, play } = harness([0.9], { score: vi.fn(async () => score(0.9, [])) });
    const outcome = await runReviewLoop(tools);

    expect(play).not.toHaveBeenCalled();
    expect(outcome.verdict).toBe('nothing-to-fix');
  });

  it('gives up on a fault the planner could not place, and tries the next', async () => {
    const two = [issue({ subjects: ['e-1'] }), issue({ code: 'terrace-oversized', repair: 'shrink-terrace' })];
    let call = 0;
    const { tools, play } = harness([0], {
      score: vi.fn(async () => score(0.5, two)),
      propose: vi.fn(async () => (call++ === 0 ? [] : [change()])),
    });

    await runReviewLoop(tools);

    // The first fault produced no change at all; the second was still tried.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stops where the user stopped it, and keeps what it had', async () => {
    const { tools, undo } = harness([0.7], { play: vi.fn(async () => 'cancelled' as const) });
    const outcome = await runReviewLoop(tools);

    expect(outcome.verdict).toBe('stopped');
    // Cancelling already put the plan back; undoing again would take away the redesign before it.
    expect(undo).not.toHaveBeenCalled();
  });

  it('reads the plan again after each pass rather than reasoning about a stale one', async () => {
    const { tools } = harness([0.7, 0.9, 0.9]);
    const elements = vi.fn(() => [ELEMENT]);

    await runReviewLoop({ ...tools, elements });

    // Once before the first pass, once after it — a run has changed the garden in between.
    expect(elements.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * A reviewer that follows a request has to stay near it.
 *
 * Asking for a bigger terrace and watching the designer go on to move the store and rewrite the
 * lighting is the moment the user stops feeling they are driving. What it found and left alone
 * comes back as an offer, which is the answer to "it saw something wrong and said nothing?".
 */
describe('scoping a review to what the request touched', () => {
  const OTHER: DesignElement = {
    id: 'e-9',
    category: 'paved-area',
    role: 'feature',
    name: 'Path to the store',
    zone: 'back',
    shape: { kind: 'polyline', width: 0.5, points: [{ x: 1, y: 1 }, { x: 6, y: 6 }] },
  } as DesignElement;

  const outside = issue({
    code: 'route-pinch',
    subjects: ['e-9'],
    message: 'The path to the store is pinched.',
  });

  it('acts on a fault about an element the request changed', async () => {
    const { tools, propose } = harness([0.7, 0.9, 0.9]);

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(propose).toHaveBeenCalledTimes(1);
    expect(outcome.passes).toHaveLength(1);
    expect(outcome.offers).toEqual([]);
  });

  it('offers a fault about something else rather than acting on it', async () => {
    const { tools, propose } = harness([0.7], {
      score: vi.fn(async () => score(0.7, [outside])),
      elements: () => [ELEMENT, OTHER],
    });

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(propose).not.toHaveBeenCalled();
    expect(outcome.passes).toEqual([]);
    expect(outcome.offers.map((offer) => offer.issue.message)).toEqual([
      'The path to the store is pinched.',
    ]);
    /* The intents come with it, so accepting costs no second look at the plan. */
    expect(outcome.offers[0]!.intents[0]).toMatchObject({ kind: 'resize' });
  });

  it('acts on everything when no scope was given', async () => {
    const { tools, propose } = harness([0.7, 0.9, 0.9], {
      score: vi.fn(async () => score(0.7, [outside])),
      elements: () => [ELEMENT, OTHER],
    });

    const outcome = await runReviewLoop(tools);

    expect(propose).toHaveBeenCalledTimes(1);
    /* Nothing is out of scope, so there is nothing to offer. */
    expect(outcome.offers).toEqual([]);
  });

  /**
   * `DesignIssue.subjects` is "element ids where they exist, else zone ids or feature names", so a
   * fault about "the back garden" would produce an offer whose intents target an element that does
   * not exist — the planner refuses every line and the chip does nothing. A chip that does nothing
   * is worse than an absent one, because the user has to press it to find out.
   */
  it('drops an offer whose subjects are not element ids', async () => {
    const zoneFault = issue({ code: 'zone-fragmented', subjects: ['back'] });
    const { tools } = harness([0.7], {
      score: vi.fn(async () => score(0.7, [zoneFault])),
      elements: () => [ELEMENT],
    });

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(outcome.offers).toEqual([]);
  });

  /** A fault it already tried is not offered back: it has had its turn. */
  it('does not offer what it already attempted', async () => {
    const { tools } = harness([0.7, 0.9, 0.9]);

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(outcome.offers).toEqual([]);
    expect(outcome.passes[0]!.kept).toBe(true);
  });
});
