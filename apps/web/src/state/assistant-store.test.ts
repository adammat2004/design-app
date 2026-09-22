import {
  leavesOf,
  type AssistantProposal,
  type DesignElement,
  type DesignRun,
} from '@garden-studio/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/plan-api';
import {
  latestSuggestions,
  resetAssistantStoreForTests,
  useAssistantStore,
  type AssistantMessage,
} from './assistant-store';
import { resetAiRunStoreForTests, useAiRunStore } from './ai-run-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from './plan-editor-store';
import { setProjectRevision } from './revision';

/**
 * The design agent's send pipeline, one test per edge of it.
 *
 * Three things are mocked, for three different reasons. The API client, so a test can hand back a
 * proposal or a status code without a server. `flushAll`, so the ordering assertion below has
 * something to observe — the flush is the part of `send` that is easy to delete by accident and
 * impossible to notice, because the only symptom is a designer answering about a slightly older
 * garden. And the run store's `playAndWait`, because the executor has its own suite and what is
 * under test here is the tail either side of it.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return {
    ...actual,
    proposeChanges: vi.fn(),
    assistantAvailability: vi.fn(async () => ({ model: true })),
  };
});

vi.mock('./project-sync', () => ({ flushAll: vi.fn() }));

const api = await import('@/lib/plan-api');
const sync = await import('./project-sync');
const proposeChanges = vi.mocked(api.proposeChanges);
const flushAll = vi.mocked(sync.flushAll);

/** Everything that happened, in order, so the flush-before-request rule can be asserted. */
let calls: string[] = [];

const patio: DesignElement = {
  id: 'e-1',
  category: 'paved-area',
  role: 'feature',
  name: 'Seating patio',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 6, y: 6 }, width: 4, depth: 3, rotation: 0 },
} as DesignElement;

const bigger = {
  ...patio,
  shape: { kind: 'rect' as const, centre: { x: 6, y: 6 }, width: 5, depth: 4, rotation: 0 },
} as DesignElement;

const resizeChange = {
  id: 'ch1',
  kind: 'resize' as const,
  elementId: 'e-1',
  label: 'Seating patio',
  before: '12 m²',
  after: '20 m²',
  previous: patio,
  next: bigger,
};

function proposal(over: Partial<AssistantProposal> = {}): AssistantProposal {
  return {
    reply: "I'll enlarge the terrace.",
    changes: [],
    suggestions: ['Make it cheaper', 'More lawn', 'Add privacy'],
    unplaceable: [],
    ...over,
  };
}

const store = () => useAssistantStore.getState();

function assistantMessages(): AssistantMessage[] {
  return store().messages.filter(
    (message): message is AssistantMessage => message.role === 'assistant',
  );
}

/** The last thing the designer said, which is the bubble every outcome is written into. */
function reply(): AssistantMessage {
  const all = assistantMessages();
  return all[all.length - 1]!;
}

/**
 * Stands in for the run engine: the plan lands where the run would have left it.
 *
 * The real executor is exercised by `executor.test.ts` against a manual clock; what matters here is
 * that the tail before and after it does the right thing with whatever it reports.
 */
function stubRun(options: { result?: DesignElement[]; status?: 'complete' | 'cancelled' } = {}) {
  const played = vi.fn(async (_run: DesignRun) => {
    if (options.result) {
      usePlanEditorStore.setState((current) => ({
        present: { ...current.present, elements: options.result! },
      }));
    }
    return options.status ?? ('complete' as const);
  });
  vi.spyOn(useAiRunStore.getState(), 'playAndWait').mockImplementation(played);
  return played;
}

/** The reviewer, answering with nothing to do unless a test says otherwise. */
function stubReview() {
  const reviewed = vi.fn(async () => null);
  vi.spyOn(useAiRunStore.getState(), 'review').mockImplementation(reviewed);
  return reviewed;
}

beforeEach(() => {
  calls = [];
  vi.restoreAllMocks();
  resetAssistantStoreForTests();
  resetAiRunStoreForTests();
  resetPlanEditorStoreForTests();
  usePlanEditorStore.setState((current) => ({
    present: { ...current.present, elements: [patio] },
  }));
  setProjectRevision({ projectId: 'p-1', revision: 4 });

  flushAll.mockReset().mockImplementation(async () => {
    calls.push('flush');
  });

  proposeChanges.mockReset().mockImplementation(async () => {
    calls.push('propose');
    return proposal();
  });
});

afterEach(() => {
  setProjectRevision(null);
});

describe('sending', () => {
  it('shows the question immediately and the answer when it arrives', async () => {
    stubReview();
    await store().send('make the patio bigger');

    expect(store().messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(store().messages[0]!.text).toBe('make the patio bigger');
    expect(reply().text).toBe("I'll enlarge the terrace.");
    expect(store().phase).toBe('idle');
  });

  it('sends the sentence and the conversation, against the loaded plan', async () => {
    stubReview();
    await store().send('  use gravel instead of paving  ');

    expect(proposeChanges).toHaveBeenCalledWith(
      'p-1',
      'use gravel instead of paving',
      [],
      [],
      expect.any(AbortSignal),
    );
  });

  /**
   * "A bit more" is the second thing anybody types. With no history it resolves to nothing at all,
   * which is why memory shipped with the panel rather than after it.
   */
  it('sends the last few turns with the next request', async () => {
    stubReview();
    await store().send('make the patio bigger');
    await store().send('a bit more');

    const history = proposeChanges.mock.calls[1]![2]!;
    expect(history).toEqual([
      { role: 'user', text: 'make the patio bigger' },
      { role: 'assistant', text: "I'll enlarge the terrace." },
    ]);
  });

  /**
   * A failed turn carries a transport message, not something the designer said about the garden.
   * Quoting it back as its own words is how a model comes to apologise for an outage.
   */
  it('leaves a failed turn out of the history', async () => {
    proposeChanges.mockRejectedValueOnce(new ApiError(503, 'nope'));
    await store().send('make the patio bigger');

    stubReview();
    await store().send('try again');

    /* The first request survives; the failure notice it produced does not. */
    expect(proposeChanges.mock.calls[1]![2]).toEqual([
      { role: 'user', text: 'make the patio bigger' },
    ]);
  });

  /**
   * The request carries no geometry, so the designer reads whatever is stored. An edit still
   * sitting in the autosave debounce would mean it answers about a garden the user cannot see.
   */
  it('flushes unsaved edits before asking', async () => {
    stubReview();
    await store().send('make the patio bigger');

    expect(calls).toEqual(['flush', 'propose']);
  });

  it('ignores an empty message and a second send while one is in flight', async () => {
    stubReview();
    await store().send('   ');
    expect(proposeChanges).not.toHaveBeenCalled();

    const first = store().send('make the patio bigger');
    await store().send('and add a shed');
    await first;

    expect(proposeChanges).toHaveBeenCalledTimes(1);
  });

  /**
   * What they are pointing at goes with the sentence, so "this" has a subject.
   *
   * Without it the designer's only correct move is to ask which element is meant — about the one
   * the user has already clicked on, which reads as the tool not watching.
   */
  it('sends what is selected on the canvas', async () => {
    stubReview();
    usePlanEditorStore.getState().select('e-1');

    await store().send('make this bigger');

    expect(proposeChanges).toHaveBeenCalledWith(
      'p-1',
      'make this bigger',
      [],
      ['e-1'],
      expect.any(AbortSignal),
    );
  });

  /**
   * A selection can go stale — an undo or a hydration can leave an id behind. Sending a ghost
   * would have the designer talk about something that is not on the plan.
   */
  it('sends nothing for a selected id that names no element', async () => {
    stubReview();
    usePlanEditorStore.setState({ selectedId: 'e-gone' });

    await store().send('make this bigger');

    expect(proposeChanges.mock.calls[0]![3]).toEqual([]);
    expect(store().messages[0]).toMatchObject({ role: 'user', about: null });
  });

  /**
   * The transcript records what a sentence was about, with the name as it stood at the time.
   *
   * Looked up when the bubble renders instead, a rename would rewrite history: the request was
   * about what the thing was called when it was made.
   */
  it('records what the request was about, keeping the name it had', async () => {
    stubReview();
    usePlanEditorStore.getState().select('e-1');

    await store().send('make this bigger');
    usePlanEditorStore.getState().renameElement('e-1', 'Dining terrace');

    expect(store().messages[0]).toMatchObject({
      role: 'user',
      about: { id: 'e-1', label: 'Seating patio' },
    });
  });

  it('keeps what could not be placed, with the planner’s reason', async () => {
    stubReview();
    proposeChanges.mockResolvedValue(
      proposal({
        unplaceable: [
          { description: 'Shed 2.0 × 1.5 m', reason: 'There is no clear space in the front garden.' },
        ],
      }),
    );

    await store().send('put a shed in the front garden');

    expect(reply().unplaceable).toHaveLength(1);
    /* And it reaches the outcome, which is what the panel actually shows. */
    expect(reply().outcome?.refused).toEqual([
      { label: 'Shed 2.0 × 1.5 m', reason: 'There is no clear space in the front garden.' },
    ]);
  });
});

describe('the phases of one request', () => {
  /** One row per edge of the send pipeline, in the order they must occur. */
  it('goes thinking, performing, reviewing, idle', async () => {
    const seen: string[] = [];
    const unsubscribe = useAssistantStore.subscribe((state) => {
      if (seen[seen.length - 1] !== state.phase) seen.push(state.phase);
    });

    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger] });
    stubReview();

    await store().send('make the patio bigger');
    unsubscribe();

    expect(seen).toEqual(['thinking', 'performing', 'reviewing', 'idle']);
  });

  it('marks the bubble at each stage rather than adding a new one', async () => {
    const statuses: string[] = [];
    const unsubscribe = useAssistantStore.subscribe((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'assistant' && statuses[statuses.length - 1] !== last.status) {
        statuses.push(last.status);
      }
    });

    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger] });
    stubReview();

    await store().send('make the patio bigger');
    unsubscribe();

    expect(statuses).toEqual(['thinking', 'performing', 'reviewing', 'done']);
    expect(assistantMessages()).toHaveLength(1);
  });

  /** A question is a real answer. Nothing is performed and nothing claims to have been. */
  it('performs nothing when the model returned no changes', async () => {
    const played = stubRun();
    stubReview();

    await store().send('what is the terrace made of?');

    expect(played).not.toHaveBeenCalled();
    expect(reply().status).toBe('done');
    expect(reply().outcome?.text).toBe('Nothing on the plan changed.');
  });

  it('says what a stopped run kept, and does not then review it', async () => {
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger], status: 'cancelled' });
    const reviewed = stubReview();

    await store().send('make the patio bigger');

    expect(reply().status).toBe('stopped');
    expect(reply().outcome?.stopped).toBe(true);
    expect(reply().outcome?.text).toContain('Stopped part way');
    /* The user has just said they have seen enough; more unasked-for work is the opposite. */
    expect(reviewed).not.toHaveBeenCalled();
  });

  /**
   * One bracket over the whole sentence — the run *and* every review pass — so Undo takes the
   * request back rather than the reviewer's last tweak.
   */
  it('opens exactly one sentence and closes it', async () => {
    const begin = vi.spyOn(useAiRunStore.getState(), 'beginSentence');
    const end = vi.spyOn(useAiRunStore.getState(), 'endSentence');

    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger] });
    stubReview();

    await store().send('make the patio bigger');

    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith('make the patio bigger');
  });

  it('closes the sentence even when the request fails', async () => {
    const end = vi.spyOn(useAiRunStore.getState(), 'endSentence');
    proposeChanges.mockRejectedValue(new ApiError(502, 'nope'));

    await store().send('make the patio bigger');

    expect(end).toHaveBeenCalledTimes(1);
    expect(store().phase).toBe('idle');
  });

  it('refuses to start over a gesture somebody else is holding', async () => {
    usePlanEditorStore.getState().beginGesture();

    await store().send('make the patio bigger');

    expect(proposeChanges).not.toHaveBeenCalled();
    expect(reply().status).toBe('failed');
    expect(reply().text).toContain('Finish the change');
  });

  it('scopes the review to the elements the request touched', async () => {
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger] });
    const reviewed = stubReview();

    await store().send('make the patio bigger');

    expect(reviewed).toHaveBeenCalledWith({ subjects: ['e-1'] });
  });

  /**
   * A request made with something selected is a request *about* that thing, whether or not the
   * designer ended up changing it. One that only moved its furniture is still work on the terrace.
   */
  it('keeps the selection in scope even when the changes went elsewhere', async () => {
    const bench = { ...patio, id: 'e-2', name: 'Bench' } as DesignElement;
    const moved = {
      ...bench,
      shape: { kind: 'rect' as const, centre: { x: 9, y: 9 }, width: 4, depth: 3, rotation: 0 },
    } as DesignElement;
    usePlanEditorStore.setState((current) => ({
      present: { ...current.present, elements: [patio, bench] },
    }));
    usePlanEditorStore.getState().select('e-1');

    proposeChanges.mockResolvedValue(
      proposal({
        changes: [
          { ...resizeChange, kind: 'move', elementId: 'e-2', previous: bench, next: moved },
        ],
      }),
    );
    stubRun({ result: [patio, moved] });
    const reviewed = stubReview();

    await store().send('move the bench off this');

    expect(reviewed).toHaveBeenCalledWith({ subjects: ['e-2', 'e-1'] });
  });

  /** One subject, not two, when the thing selected is also the thing that changed. */
  it('does not name the same element twice', async () => {
    usePlanEditorStore.getState().select('e-1');
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    stubRun({ result: [bigger] });
    const reviewed = stubReview();

    await store().send('make this bigger');

    expect(reviewed).toHaveBeenCalledWith({ subjects: ['e-1'] });
  });

  it('turns the proposal into operations rather than applying it', async () => {
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));
    const played = stubRun({ result: [bigger] });
    stubReview();

    await store().send('make the patio bigger');

    const run = played.mock.calls[0]![0];
    // The same edit, as operations: no second request and nothing new on the wire.
    expect(run.operations.flatMap(leavesOf).map((leaf) => leaf.kind)).toEqual(['select', 'resize']);
  });
});

describe('when the designer cannot answer', () => {
  it('reads a 503 as switched off rather than broken', async () => {
    proposeChanges.mockRejectedValue(new ApiError(503, 'Request failed with 503.'));

    await store().send('make the patio bigger');

    expect(reply().status).toBe('failed');
    expect(reply().text).toContain('unavailable');
  });

  it('says something different about being rate limited', async () => {
    proposeChanges.mockRejectedValue(new ApiError(429, 'Request failed with 429.'));

    await store().send('make the patio bigger');

    expect(reply().text).toContain('try again');
  });

  /**
   * The failure lands in the bubble already on screen.
   *
   * A separate error line beside a stranded "thinking…" bubble is two pieces of state saying
   * different things about one request — and the abandoned bubble then goes into the history as
   * something the designer supposedly said.
   */
  it('fails the reply it belongs to, and starts no run', async () => {
    const played = stubRun();
    proposeChanges.mockRejectedValue(new ApiError(502, 'Request failed with 502.'));

    await store().send('make the patio bigger');

    expect(assistantMessages()).toHaveLength(1);
    expect(reply().status).toBe('failed');
    expect(reply().outcome).toBeNull();
    expect(played).not.toHaveBeenCalled();
    expect(store().phase).toBe('idle');
  });

  it('fails the same way when the network is down', async () => {
    proposeChanges.mockRejectedValue(new TypeError('Failed to fetch'));

    await store().send('make the patio bigger');

    expect(reply().text).toContain('Could not reach');
  });

  it('does not ask at all when no plan is loaded', async () => {
    setProjectRevision(null);

    await store().send('make the patio bigger');

    expect(proposeChanges).not.toHaveBeenCalled();
    expect(reply().status).toBe('failed');
  });
});

describe('leaving the screen mid-request', () => {
  /**
   * The tail stops where it is. Nothing new starts on a screen nobody is looking at, and the
   * bracket does not outlive the component that could close it.
   */
  it('abandons the tail, starts no run, and closes the bracket', async () => {
    const played = stubRun({ result: [bigger] });
    const end = vi.spyOn(useAiRunStore.getState(), 'endSentence');

    /*
     * The deferred is built up front rather than inside the mock: the request is only issued after
     * `flushAll` resolves, so a resolver assigned in the executor is still undefined at the moment
     * a synchronous `abandon()` runs — and the promise would never settle.
     */
    let release: (value: AssistantProposal) => void = () => {};
    const pending = new Promise<AssistantProposal>((resolve) => {
      release = resolve;
    });
    let asked = false;
    proposeChanges.mockImplementation(() => {
      asked = true;
      return pending;
    });

    const sending = store().send('make the patio bigger');
    await vi.waitFor(() => expect(asked).toBe(true));

    store().abandon();
    release(proposal({ changes: [resizeChange] }));
    await sending;

    expect(played).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(store().phase).toBe('idle');
    /* No invented failure either: nothing went wrong, the screen went away. */
    expect(reply().status).toBe('thinking');
  });
});

describe('when the person has asked not to be animated at', () => {
  /**
   * The run applies at once instead of playing. This is why `applyProposal` was kept rather than
   * deleted with the tick-and-apply UI — without it the feature is unusable for anyone with
   * vestibular sensitivity.
   */
  it('applies the changes with no frames, and reports the same outcome', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const played = stubRun();
    stubReview();
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));

    await store().send('make the patio bigger');

    expect(played).not.toHaveBeenCalled();
    expect(reply().status).toBe('done');
    expect(reply().outcome?.changed).toBe(1);
    /* The garden really did change, rather than the outcome merely saying so. */
    const shape = usePlanEditorStore.getState().present.elements[0]!.shape;
    expect(shape).toMatchObject({ width: 5, depth: 4 });

    vi.unstubAllGlobals();
  });

  /** One bracket still, so the whole sentence is one Undo whichever path it took. */
  it('does not close the sentence bracket when it applies', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query })),
    );

    stubReview();
    proposeChanges.mockResolvedValue(proposal({ changes: [resizeChange] }));

    const before = usePlanEditorStore.getState().past.length;
    await store().send('make the patio bigger');

    /* One entry for the sentence, pushed when `endSentence` closed it — never two. */
    expect(usePlanEditorStore.getState().past.length).toBe(before + 1);
    expect(usePlanEditorStore.getState().gestureSnapshot).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('suggestions', () => {
  it('opens with a generic set and then follows the latest reply', async () => {
    stubReview();
    const opening = latestSuggestions(store());
    expect(opening.length).toBeGreaterThanOrEqual(3);

    await store().send('make the patio bigger');

    expect(latestSuggestions(store())).toEqual(['Make it cheaper', 'More lawn', 'Add privacy']);
  });

  /** Zustand v5 compares snapshots by identity, so the opening set must not be rebuilt per call. */
  it('returns a stable opening array', () => {
    expect(latestSuggestions(store())).toBe(latestSuggestions(store()));
  });
});

describe('availability', () => {
  it('records that the server has a key', async () => {
    await store().probeAvailability();
    expect(store().available).toBe(true);
  });

  it('records that it has none', async () => {
    vi.mocked(api.assistantAvailability).mockResolvedValueOnce({ model: false });
    await store().probeAvailability();
    expect(store().available).toBe(false);
  });

  /**
   * An API that is not running yet is not evidence that there is no key. Leaving it null keeps the
   * ordinary opening on screen and lets the request itself say what is wrong, in its own words.
   */
  it('stays undecided when the probe cannot reach the server', async () => {
    vi.mocked(api.assistantAvailability).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await store().probeAvailability();
    expect(store().available).toBeNull();
  });
});
