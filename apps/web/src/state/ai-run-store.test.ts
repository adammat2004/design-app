import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignRunSchema, type DesignRun } from '@garden-studio/schema';
import { manualClock, type ManualClock } from '@/lib/ai-run/clock';
import type { DesignElement } from '@/lib/concepts';
import { resetAiRunStoreForTests, selectRunActive, setRunClockFactory, useAiRunStore } from './ai-run-store';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import { setProjectRevision } from './revision';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from './plan-editor-store';

/*
 * Both mocks follow `project-sync.test.ts`: what is interesting here is the plumbing — which events
 * a run reports, and how the loop moves the plan — not that a batcher batches or a client fetches.
 * The reviewer's own judgement is tested against fakes in `review-loop.test.ts`.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, reviewDesign: vi.fn(), requestRedesign: vi.fn() };
});

/* The emitter, for the same reason. */
vi.mock('./design-events', async () => {
  const actual = await vi.importActual<typeof import('./design-events')>('./design-events');
  return { ...actual, emitDesignEvent: vi.fn() };
});

const events = vi.mocked((await import('./design-events')).emitDesignEvent);
const api = await import('@/lib/plan-api');
const reviewDesign = vi.mocked(api.reviewDesign);
const requestRedesign = vi.mocked(api.requestRedesign);

const editor = () => usePlanEditorStore.getState();
const ai = () => useAiRunStore.getState();

let clock: ManualClock;

/** A 20 x 16 plot with a house in the middle — step 1, done. */
function mapProperty(): void {
  const boundary = useBoundaryStore.getState();
  boundary.addVertexAt({ x: 0, y: 0 });
  boundary.addVertexAt({ x: 20, y: 0 });
  boundary.addVertexAt({ x: 20, y: 16 });
  boundary.addVertexAt({ x: 0, y: 16 });
  boundary.closeShape();
}

function element(over: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    shape: { kind: 'rect', centre: { x: 6, y: 6 }, width: 4, depth: 3, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

function seed(elements: DesignElement[]): void {
  usePlanEditorStore.setState({ present: { elements }, past: [], future: [] });
}

function op(over: Record<string, unknown>) {
  return { id: 'op', agent: 'layout', phase: 'layout', label: 'Working', ...over };
}

function run(operations: Record<string, unknown>[]): DesignRun {
  return DesignRunSchema.parse({ id: 'run-1', request: 'Better for entertaining', operations });
}

/** Two moves, so there is something to be half way through. */
const TWO_MOVES = () =>
  run([
    op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 8, y: 6 } }),
    op({ id: 'b', kind: 'move', elementId: 'e-1', to: { x: 10, y: 6 } }),
  ]);

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  resetAiRunStoreForTests();
  events.mockReset();

  clock = manualClock();
  setRunClockFactory(() => clock);

  reviewDesign.mockReset();
  requestRedesign.mockReset();
  setProjectRevision({ projectId: '11111111-2222-3333-4444-555555555555', revision: 1 });

  mapProperty();
  seed([element({ id: 'e-1' })]);
});

describe('starting a run', () => {
  it('plays the operations against the real plan', () => {
    expect(ai().start(TWO_MOVES())).toEqual({ ok: true });
    expect(selectRunActive(ai())).toBe(true);

    clock.advance(600);
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 8, y: 6 } });

    clock.advance(1000);
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 10, y: 6 } });
    expect(ai().status).toBe('complete');
  });

  it('refuses a second request rather than queueing it', () => {
    ai().start(TWO_MOVES());
    const second = ai().start(TWO_MOVES());

    expect(second).toEqual({ ok: false, reason: 'A redesign is already running.' });
    expect(ai().blocked).toBe('A redesign is already running.');
  });

  it('refuses to start in the middle of somebody else\'s gesture', () => {
    editor().beginGesture();

    expect(ai().start(TWO_MOVES())).toMatchObject({ ok: false });
    // And the user's own gesture is untouched.
    expect(editor().gestureSnapshot).not.toBeNull();
  });

  it('says why rather than playing a run that would change nothing', () => {
    const outside = run([op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 40, y: 6 } })]);

    expect(ai().start(outside)).toEqual({ ok: false, reason: 'That goes over the property boundary.' });
    expect(ai().status).toBe('idle');
    expect(editor().past).toHaveLength(0);
  });

  it('reports what it could not do, and does the rest', () => {
    const mixed = run([
      op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 40, y: 6 } }),
      op({ id: 'b', kind: 'move', elementId: 'e-1', to: { x: 9, y: 6 } }),
    ]);

    expect(ai().start(mixed)).toEqual({ ok: true });
    clock.advance(5000);

    expect(ai().refused).toEqual([
      { operationId: 'a', label: 'Working', reason: 'That goes over the property boundary.' },
    ]);
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 9, y: 6 } });
  });
});

describe('what a run costs the undo stack', () => {
  it('is one entry, however many operations it ran', () => {
    const before = editor().present;

    ai().start(TWO_MOVES());
    clock.advance(5000);

    expect(editor().past).toHaveLength(1);
    expect(editor().past[0]).toBe(before);

    editor().undo();
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });
  });

  it('leaves no entry at all when it is stopped', () => {
    const before = editor().present.elements;

    ai().start(TWO_MOVES());
    clock.advance(700);
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 8, y: 6 } });

    ai().cancel();

    // Put back as found, and nothing to undo: stopping leaves no trace.
    expect(editor().present.elements).toBe(before);
    expect(editor().past).toHaveLength(0);
    expect(ai().status).toBe('cancelled');
  });

  it('closes its bracket even when it is stopped before anything landed', () => {
    ai().start(TWO_MOVES());
    ai().cancel();

    expect(editor().gestureSnapshot).toBeNull();
  });

  it('does not report the run as somebody moving an element by hand', () => {
    // A one-operation run is exactly the shape `gestureChange` files as a hand edit.
    ai().start(run([op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 8, y: 6 } })]));
    clock.advance(5000);

    const kinds = events.mock.calls.map(([kind]) => kind);
    expect(kinds).toContain('ai_redesign_applied');
    expect(kinds).not.toContain('element_moved');
  });

  it('records the run starting and landing, with how much it changed', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);

    expect(events.mock.calls).toEqual([
      ['ai_redesign_started'],
      ['ai_redesign_applied', { delta: 1 }],
    ]);
  });

  it('records a stopped run as stopped', () => {
    ai().start(TWO_MOVES());
    clock.advance(300);
    ai().cancel();

    expect(events.mock.calls.map(([kind]) => kind)).toEqual([
      'ai_redesign_started',
      'ai_redesign_cancelled',
    ]);
  });
});

describe('pausing, skipping and settling', () => {
  it('holds still while paused', () => {
    ai().start(TWO_MOVES());
    clock.advance(300);
    ai().pause();

    const held = editor().present.elements;
    clock.advance(10_000);

    expect(editor().present.elements).toBe(held);
    expect(ai().status).toBe('paused');

    ai().resume();
    clock.advance(5000);
    expect(ai().status).toBe('complete');
  });

  it('applies the rest at once when the animation is skipped', () => {
    ai().start(TWO_MOVES());
    clock.advance(100);
    ai().skipToEnd();

    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 10, y: 6 } });
    expect(ai().status).toBe('complete');
    expect(editor().past).toHaveLength(1);
  });

  it('keeps the work when the screen goes away under it', () => {
    ai().start(TWO_MOVES());
    clock.advance(100);
    ai().settle();

    // Navigating on is not objecting: the run finishes rather than being thrown away.
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 10, y: 6 } });
    expect(editor().gestureSnapshot).toBeNull();
  });
});

describe('what is left afterwards', () => {
  it('keeps a revision to compare with and replay', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);

    const revision = ai().revision!;
    expect(revision.initial[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });
    expect(revision.result[0]!.shape).toMatchObject({ centre: { x: 10, y: 6 } });
    expect(revision.request).toBe('Better for entertaining');
  });

  it('shows the plan before the change without touching it', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);

    const present = editor().present;
    const history = editor().past.length;

    ai().toggleCompare();
    expect(ai().compare).toBe('before');
    // Compare is a view: the plan and its history are exactly as they were.
    expect(editor().present).toBe(present);
    expect(editor().past).toHaveLength(history);

    ai().toggleCompare();
    expect(ai().compare).toBe('after');
  });

  it('undoes the whole redesign in one go', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);

    ai().undoRun();

    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });
    expect(events.mock.calls.map(([kind]) => kind)).toContain('ai_redesign_undone');
  });

  it('will not undo a redesign the user has since edited', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);

    editor().setPosition('e-1', { x: 5, y: 5 });
    ai().undoRun();

    // Their edit stands; the ordinary Undo in the toolbar is the right tool now.
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 5, y: 5 } });
  });

  it('replays without writing a second undo entry', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);
    const history = editor().past.length;

    ai().replay();
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });

    clock.advance(5000);

    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 10, y: 6 } });
    expect(editor().past).toHaveLength(history);
    expect(ai().status).toBe('complete');
  });

  it('gives the same new element the same id when it is replayed', () => {
    const adding = run([
      op({ id: 'a', phase: 'planting', kind: 'add', ref: '$shrub', element: {
        category: 'planting-bed', role: 'feature', name: 'Evergreen shrub', zone: 'back',
        shape: { kind: 'point', at: { x: 12, y: 10 }, radius: 0.6 } } }),
    ]);

    ai().start(adding);
    clock.advance(5000);
    const first = editor().present.elements.at(-1)!.id;

    ai().replay();
    clock.advance(5000);

    expect(editor().present.elements.at(-1)!.id).toBe(first);
    expect(editor().present.elements.filter((candidate) => candidate.id === first)).toHaveLength(1);
  });

  it('leaves the redesign in place when a replay is stopped half way', () => {
    ai().start(TWO_MOVES());
    clock.advance(5000);
    const result = editor().present.elements;

    ai().replay();
    clock.advance(300);
    ai().cancel();

    // Not the garden before the redesign: stopping a replay must not undo the thing being replayed.
    expect(editor().present.elements).toBe(result);
  });
});

describe('the design reviewer', () => {
  /** A score the fake server hands back, with one fault the loop knows how to act on. */
  function score(total: number, issues = [{
    code: 'terrace-oversized', principle: 'proportion', severity: 'major',
    message: 'The terrace takes most of the garden.',
    subjects: ['e-1'], repair: 'shrink-terrace',
  }]) {
    return { score: { total, categories: {}, issues, tier: 'realised' } };
  }

  const moved = {
    changes: [{
      id: 'ch1', kind: 'move', elementId: 'e-1', label: 'Seating patio',
      before: 'here', after: 'there',
      previous: element({ id: 'e-1' }),
      next: element({ id: 'e-1', shape: { kind: 'rect', centre: { x: 9, y: 6 }, width: 4, depth: 3, rotation: 0 } }),
    }],
    unplaceable: [],
  };

  it('plays the reviewer\'s correction and keeps it when the plan measurably improved', async () => {
    reviewDesign.mockResolvedValueOnce(score(0.70) as never).mockResolvedValue(score(0.85) as never);
    requestRedesign.mockResolvedValue(moved as never);

    const running = ai().review();
    // The run is live and animating; the loop is waiting on it, not polling.
    await vi.waitFor(() => expect(selectRunActive(ai())).toBe(true));
    clock.advance(10_000);
    await running;

    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 9, y: 6 } });
    expect(ai().reviewOutcome).toMatchObject({ verdict: 'improved' });
    expect(ai().reviewing).toBe(false);
  });

  it('puts its own change back when the measurement does not support it', async () => {
    reviewDesign.mockResolvedValueOnce(score(0.80) as never).mockResolvedValue(score(0.79) as never);
    requestRedesign.mockResolvedValue(moved as never);

    const running = ai().review();
    await vi.waitFor(() => expect(selectRunActive(ai())).toBe(true));
    clock.advance(10_000);
    await running;

    // Back where it started, and no entry left on the undo stack for the user to trip over.
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });
    expect(ai().reviewOutcome).toMatchObject({ verdict: 'nothing-worked' });
  });

  it('changes nothing when it has no complaint', async () => {
    reviewDesign.mockResolvedValue(score(0.9, []) as never);

    await ai().review();

    expect(requestRedesign).not.toHaveBeenCalled();
    expect(ai().reviewOutcome).toMatchObject({ verdict: 'nothing-to-fix' });
    expect(editor().past).toHaveLength(0);
  });

  it('says so rather than throwing when the server cannot be reached', async () => {
    reviewDesign.mockRejectedValue(new Error('offline'));

    await ai().review();

    expect(ai().blocked).toBe('The design reviewer could not be reached.');
    expect(ai().reviewing).toBe(false);
    expect(editor().present.elements[0]!.shape).toMatchObject({ centre: { x: 6, y: 6 } });
  });

  it('will not review while a redesign is already running', async () => {
    ai().start(TWO_MOVES());
    await ai().review();

    expect(reviewDesign).not.toHaveBeenCalled();
  });
});
