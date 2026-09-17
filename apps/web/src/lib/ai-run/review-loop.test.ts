import { describe, expect, it, vi } from 'vitest';
import type {
  DesignElement,
  DesignIssue,
  DesignScore,
  ProposedChange,
} from '@garden-studio/schema';
import {
  firstRepairable,
  issueKey,
  offersFrom,
  runReviewLoop,
  type ReviewTools,
} from './review-loop';
import { REPAIR_CAPABILITIES, REPAIR_KINDS, performableInEditor } from '@garden-studio/schema';

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
    source: 'geometry',
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
    next: {
      ...ELEMENT,
      shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 2, depth: 2, rotation: 0 },
    },
  } as ProposedChange;
}

/** What the server answers when it found a correction worth making. */
function repaired(changes: ProposedChange[] = [change()]) {
  return {
    changes,
    predicted: { before: 0.7, after: 0.8, resolved: true },
    considered: 4,
    reason: null,
  };
}

/** What it answers when it looked and found nothing worth doing. */
function nothing(reason = 'Nothing that could be done about it makes the design better.') {
  return { changes: [], predicted: null, considered: 3, reason };
}

/** A loop with everything faked, and scores handed out in the order the test wants them. */
function harness(totals: number[], over: Partial<ReviewTools> = {}) {
  const undo = vi.fn();
  const play = vi.fn(async () => 'complete' as const);
  const repair = vi.fn(async () => repaired());
  let call = 0;

  const tools: ReviewTools = {
    elements: () => [ELEMENT],
    score: vi.fn(async () => score(totals[Math.min(call++, totals.length - 1)]!)),
    repair,
    play,
    undo,
    ...over,
  };
  return { tools, undo, play, repair };
}

describe('what the reviewer can act on', () => {
  /*
   * There used to be three tables saying what a repair could do — one here, one in the generator's
   * repair stage, and a third expressed as the set of branches somebody had remembered to write in
   * `intentsFor`. A repair kind was performable if and only if all three happened to agree. There is
   * one now, in the schema, and these read it rather than restating it.
   */

  it('has an answer for every kind of fault the scorer can name', () => {
    for (const kind of REPAIR_KINDS) {
      expect(REPAIR_CAPABILITIES[kind], kind).toBeDefined();
      expect(REPAIR_CAPABILITIES[kind].editor.length, kind).toBeGreaterThan(0);
    }
  });

  it('states why for each fault it cannot perform, rather than silently doing nothing', () => {
    const cannot = REPAIR_KINDS.filter((kind) => !performableInEditor(kind));
    expect(cannot.length).toBeGreaterThan(0);

    for (const kind of cannot) {
      /* A sentence a person can read, not a boolean. A limitation written down can be closed. */
      expect(REPAIR_CAPABILITIES[kind].editor.length, kind).toBeGreaterThan(20);
    }
  });

  it('can now perform the three move faults it never could', () => {
    /*
     * Measured before `IssueGuidance` existed: mapped to "towards the boundary" — the only
     * destination an intent could name — the planner refused every move fault across four generated
     * fixtures with "it is already as far that way as it will go".
     */
    for (const kind of ['move-to-zone', 'move-destination', 'move-tree', 'align'] as const) {
      expect(performableInEditor(kind), kind).toBe(true);
    }
  });

  it('takes the worst fault first', () => {
    const worst = issue({
      code: 'terrace-oversized',
      severity: 'critical',
      repair: 'shrink-terrace',
    });
    const lesser = issue({ severity: 'minor' });
    const both = score(0.7, [lesser, worst]);

    expect(firstRepairable(both, new Set(), [ELEMENT])?.code).toBe('terrace-oversized');
    expect(firstRepairable(both, new Set([issueKey(worst)]), [ELEMENT])?.code).toBe(
      'route-too-narrow',
    );
  });

  it('tells two faults of the same kind apart', () => {
    /*
     * Three pinched paths are three things to fix. Keyed on the code alone the loop widened one and
     * wrote the others off as already tried, which is what it did before this was a test.
     */
    const first = issue({ subjects: ['e-7'] });
    const second = issue({ subjects: ['e-9'] });
    const both = score(0.7, [first, second]);
    const plan = [ELEMENT, { ...ELEMENT, id: 'e-9' }];

    expect(firstRepairable(both, new Set([issueKey(first)]), plan)?.subjects).toEqual(['e-9']);
    expect(firstRepairable(both, new Set([issueKey(first), issueKey(second)]), plan)).toBeNull();
  });

  it('skips a fault nothing can perform rather than stalling on it', () => {
    const unfixable = issue({ code: 'bed-islands', severity: 'critical', repair: 'merge-beds' });
    const fixable = issue({ severity: 'minor' });

    expect(firstRepairable(score(0.7, [unfixable, fixable]), new Set(), [ELEMENT])?.code).toBe(
      'route-too-narrow',
    );
  });

  it('ignores a fault that names nothing on the plan', () => {
    /* Issues may name a zone or a feature rather than an element; those name nothing to change. */
    const zoneFault = issue({ code: 'zone-fragmented', subjects: ['back'] });
    expect(firstRepairable(score(0.7, [zoneFault]), new Set(), [ELEMENT])).toBeNull();
    expect(offersFrom(score(0.7, [zoneFault]), new Set(), [ELEMENT], ['e-7'])).toEqual([]);
  });
});

describe('the loop', () => {
  it('keeps a change that measurably improved the plan', async () => {
    const { tools, undo } = harness([0.7, 0.8, 0.8]);
    const outcome = await runReviewLoop(tools);

    expect(outcome.verdict).toBe('improved');
    expect(outcome.passes[0]).toMatchObject({ before: 0.7, after: 0.8, kept: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('winds back a change that did not', async () => {
    const { tools, undo } = harness([0.8, 0.79]);
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
    /* Each fault has to name something on the plan, or the loop is right to skip it. */
    const plan = [{ ...ELEMENT, id: 'e-1' }, { ...ELEMENT, id: 'e-2' }, ELEMENT];
    const { tools, play } = harness([0], {
      elements: () => plan,
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

  it('plays nothing at all when the server found nothing worth doing', async () => {
    /*
     * The pass the old loop could not have. It mapped a fault to one intent, took whatever the
     * planner's first legal step was and *animated* it, and only then measured — so about half the
     * time the user watched the designer try something a measurement taken beforehand would have
     * ruled out. The search happens on the server now, and a correction that helps nothing is
     * reported rather than performed.
     */
    const { tools, play, undo } = harness([0.7], { repair: vi.fn(async () => nothing()) });

    const outcome = await runReviewLoop(tools);

    expect(play).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(outcome.passes[0]).toMatchObject({ played: false, kept: false, considered: 3 });
    expect(outcome.passes[0]!.reason).toContain('makes the design better');
    expect(outcome.verdict).toBe('nothing-worked');
  });

  it('gives up on a fault nothing could be done about, and tries the next', async () => {
    const two = [
      issue({ subjects: ['e-7'] }),
      issue({ code: 'terrace-oversized', repair: 'shrink-terrace' }),
    ];
    let call = 0;
    const { tools, play } = harness([0], {
      score: vi.fn(async () => score(0.5, two)),
      repair: vi.fn(async () => (call++ === 0 ? nothing() : repaired())),
    });

    await runReviewLoop(tools);

    // The first fault produced no change at all; the second was still tried.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('says what it is doing, and only what it actually did', async () => {
    const said: (string | null)[] = [];
    const { tools } = harness([0.7, 0.9, 0.9]);

    await runReviewLoop({ ...tools, narrate: (status) => said.push(status) });

    /* Every line is read off something measured: the fault's own sentence, the server's own count. */
    expect(said[0]).toBe('Checking the composition');
    expect(said).toContain('The path to the store is 0.5 m wide.');
    expect(said).toContain('Testing 4 corrections');
    /* And it stops claiming to be doing anything when it is not. */
    expect(said[said.length - 1]).toBeNull();
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
    shape: {
      kind: 'polyline',
      width: 0.5,
      points: [
        { x: 1, y: 1 },
        { x: 6, y: 6 },
      ],
    },
  } as DesignElement;

  const outside = issue({
    code: 'route-pinch',
    subjects: ['e-9'],
    message: 'The path to the store is pinched.',
  });

  it('acts on a fault about an element the request changed', async () => {
    const { tools, repair } = harness([0.7, 0.9, 0.9]);

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(outcome.passes).toHaveLength(1);
    expect(outcome.offers).toEqual([]);
  });

  it('offers a fault about something else rather than acting on it', async () => {
    const { tools, repair } = harness([0.7], {
      score: vi.fn(async () => score(0.7, [outside])),
      elements: () => [ELEMENT, OTHER],
    });

    const outcome = await runReviewLoop({ ...tools, subjects: ['e-7'] });

    expect(repair).not.toHaveBeenCalled();
    expect(outcome.passes).toEqual([]);
    expect(outcome.offers.map((offer) => offer.issue.message)).toEqual([
      'The path to the store is pinched.',
    ]);
    /*
     * It carries the fault and nothing else. It used to carry the intents the reviewer had worked
     * out at offer time, against a plan the user then went on editing — so accepting a minute later
     * applied an answer to a garden that no longer existed.
     */
    expect(Object.keys(outcome.offers[0]!)).toEqual(['issue']);
  });

  it('acts on everything when no scope was given', async () => {
    const { tools, repair } = harness([0.7, 0.9, 0.9], {
      score: vi.fn(async () => score(0.7, [outside])),
      elements: () => [ELEMENT, OTHER],
    });

    const outcome = await runReviewLoop(tools);

    expect(repair).toHaveBeenCalledTimes(1);
    /* Nothing is out of scope, so there is nothing to offer. */
    expect(outcome.offers).toEqual([]);
  });

  /**
   * `DesignIssue.subjects` is "element ids where they exist, else zone ids or feature names", so a
   * fault about "the back garden" names nothing the planner can change — and a chip for it does
   * nothing, which is worse than an absent one because the user has to press it to find out.
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
