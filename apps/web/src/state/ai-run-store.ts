'use client';

import { create } from 'zustand';
import type { DesignElement, DesignRun, Point } from '@garden-studio/schema';
import { browserClock, type Clock } from '@/lib/ai-run/clock';
import { createRunController, type RunController } from '@/lib/ai-run/controller';
import type { RunFrame } from '@/lib/ai-run/evaluate';
import { prepareRun, type PreparedRun } from '@/lib/ai-run/prepare';
import { runReviewLoop, type ReviewOutcome } from '@/lib/ai-run/review-loop';
import { requestRedesign, reviewDesign } from '@/lib/plan-api';
import { draftPolygon } from '@/lib/boundary-geometry';
import { useBoundaryStore } from './boundary-store';
import { emitDesignEvent } from './design-events';
import { layoutFingerprint } from '@/lib/concepts';
import { allocateElementId, usePlanEditorStore } from './plan-editor-store';
import { projectRevision } from './revision';

/**
 * A redesign the user can watch happen.
 *
 * This store owns the *run*; it does not own the plan. Every change to the garden goes through
 * `plan-editor-store` exactly as a drag does, inside one `beginGesture` / `endGesture` bracket —
 * which is where undo, cancel and "one entry however many operations" all come from, for free and
 * for the same reason an applied assistant diff costs one Undo.
 *
 * Nothing here interpolates anything. The executor is pure and lives in `lib/ai-run/`; this is the
 * adaptor between it and the three things it has to touch: the plan, the selection, and the
 * telemetry. What the canvas draws while a change is in flight is `frame`, which is presentation
 * and never reaches the document.
 *
 * **There is no working copy**, deliberately. A separate draft of the plan would mean the renderer
 * drawing something other than `present`, which is the one thing this architecture does not allow;
 * and the gesture bracket already is a transaction, with a snapshot to restore and a single entry
 * on the undo stack.
 */

export type RunStatus = 'idle' | 'running' | 'paused' | 'complete' | 'cancelled';

/** What a finished run leaves behind, so it can be compared with and replayed. */
export interface DesignRevision {
  id: string;
  request: string;
  createdAt: number;
  prepared: PreparedRun;
  /** The plan as it was before the run, which is what Compare shows and Cancel restores. */
  initial: DesignElement[];
  result: DesignElement[];
  refused: PreparedRun['refused'];
  summary: string | null;
  /**
   * Whether the run reached its end.
   *
   * A stopped run still leaves a revision — Undo and Compare need one — but it cannot be replayed:
   * `prepared` is the whole timeline including the part the user stopped, and replaying it would
   * do more than they allowed.
   */
  complete: boolean;
}

interface AiRunState {
  status: RunStatus;
  prepared: PreparedRun | null;
  frame: RunFrame | null;
  refused: PreparedRun['refused'];
  /** Which side of the change the canvas is showing. Never touches the plan or the history. */
  compare: 'after' | 'before';
  revision: DesignRevision | null;
  /** Why the last attempt to start could not, for the panel to say out loud. */
  blocked: string | null;
  /** True while the reviewer is reading, between its runs. */
  reviewing: boolean;
  /** What the reviewer found and what it did about it, for the panel. */
  reviewOutcome: ReviewOutcome | null;

  start: (run: DesignRun) => { ok: true } | { ok: false; reason: string };
  pause: () => void;
  resume: () => void;
  skipToEnd: () => void;
  cancel: () => void;
  replay: () => void;
  undoRun: () => void;
  toggleCompare: () => void;
  dismiss: () => void;
  /**
   * Opens one gesture bracket over everything one request leads to.
   *
   * False when something else already holds the editor's gesture — a drag in progress, or a
   * sentence that has not been closed.
   */
  beginSentence: () => boolean;
  /** Closes it and reports the whole request once. The text is what the record names. */
  endSentence: (request?: string) => void;
  /** Plays a run and resolves when it ends. What the review loop is built on. */
  playAndWait: (run: DesignRun) => Promise<'complete' | 'cancelled' | 'refused'>;
  /**
   * The design reviewer: read the plan, fix the worst thing it can, keep it only if it helped.
   *
   * `subjects` scopes what it may act on to the elements a request touched; omit it and the whole
   * plan is in scope, which is what "Review my design" asked on its own means. The outcome is
   * returned as well as stored, because the conversation has to say what happened in the reply it
   * belongs to — and null when it could not run at all.
   */
  review: (options?: { subjects?: string[] }) => Promise<ReviewOutcome | null>;
  /** Ends any run immediately, keeping its work. For a screen going away under it. */
  settle: () => void;
}

/** The controller is a live object with a frame loop; it has no business in a store snapshot. */
let controller: RunController | null = null;
let replaying = false;

/**
 * The sentence in progress: **one** gesture bracket over a request's run *and* every review pass
 * that follows it.
 *
 * The bracket used to be per *run*, which quietly broke the two promises this feature rests on. A
 * request that the reviewer then corrected twice opened three brackets, so `endGesture` wrote three
 * undo entries and one press of Undo took back only the reviewer's last tweak. And because the
 * revision was rewritten by each run, Compare showed the garden before that tweak rather than
 * before the sentence. One bracket per thing the user said is the only version where "Undo takes
 * the whole thing back" is true.
 *
 * `implicit` marks a sentence a run opened for itself — the demo button, a replay — so the same run
 * closes it. A caller that opens one explicitly (the design agent's `send`) owns closing it.
 */
let sentence: { initial: DesignElement[]; implicit: boolean } | null = null;

/**
 * The plan as the run that is playing found it, so one pass can be wound back without the history.
 *
 * Needed because the reviewer's gate — keep the change only if the score measurably rose — has to
 * be able to put a pass back, and inside a sentence there is *nothing on the undo stack to pop*:
 * the bracket is still open, so `undo()` would take back whatever the user did by hand before they
 * asked. See `undoLastRun`.
 */
let lastRunInitial: DesignElement[] | null = null;

/**
 * Resolved when the run in progress ends, so the review loop can wait for it.
 *
 * A promise rather than a store subscription: "play this and tell me how it went" is what the loop
 * needs, and watching `status` for a transition means reasoning about which transition, from which
 * state, and what happens if two arrive in one tick.
 */
let settle: ((status: 'complete' | 'cancelled') => void) | null = null;

function finishWaiters(status: 'complete' | 'cancelled'): void {
  const waiting = settle;
  settle = null;
  waiting?.(status);
}

/** Swappable so the whole store can be driven by a manual clock in a test. */
let clockFactory: () => Clock = browserClock;
export function setRunClockFactory(factory: () => Clock): void {
  clockFactory = factory;
}

function boundaryNow(): Point[] {
  return draftPolygon(useBoundaryStore.getState().present);
}

/** How many elements a run actually changed — the only number the telemetry carries. */
function changedCount(before: DesignElement[], after: DesignElement[]): number {
  const was = new Map(before.map((element) => [element.id, element]));
  let changed = after.filter((element) => was.get(element.id) !== element).length;
  for (const element of before) if (!after.some((candidate) => candidate.id === element.id)) changed += 1;
  return changed;
}

export const useAiRunStore = create<AiRunState>((set, get) => ({
  status: 'idle',
  prepared: null,
  frame: null,
  refused: [],
  compare: 'after',
  revision: null,
  blocked: null,
  reviewing: false,
  reviewOutcome: null,

  start: (run) => {
    const state = get();
    if (state.status === 'running' || state.status === 'paused') {
      /*
       * Refused rather than queued. A queue stacks up intent the user cannot see and cannot
       * cancel, and the second request was almost certainly written about the garden as it looks
       * now — which is not the garden the first run is going to leave behind.
       */
      const reason = 'A redesign is already running.';
      set({ blocked: reason });
      return { ok: false, reason };
    }

    const editor = usePlanEditorStore.getState();
    /* A gesture that is not ours is somebody dragging; a sentence of our own is fine to run in. */
    if (!sentence && editor.gestureSnapshot !== null) {
      const reason = 'Finish the change you are making first.';
      set({ blocked: reason });
      return { ok: false, reason };
    }

    const initial = editor.present.elements;
    const prepared = prepareRun(run, initial, {
      boundary: boundaryNow(),
      allocateId: allocateElementId,
    });

    /*
     * A run with nothing left to do is reported rather than played. Watching a cursor travel
     * around a garden that never changes is worse than being told the plan has moved on.
     */
    if (prepared.result === prepared.initial) {
      const reason = prepared.refused[0]?.reason ?? 'There was nothing left to change.';
      set({ blocked: reason, refused: prepared.refused });
      return { ok: false, reason };
    }

    /*
     * A run outside a sentence opens one for itself — the demo button, a replay. The sentence is
     * what holds the bracket now; a run never opens a bracket of its own.
     */
    if (!sentence) {
      editor.beginGesture();
      sentence = { initial, implicit: true };
      emitDesignEvent('ai_redesign_started');
    }

    lastRunInitial = prepared.initial;

    controller?.dispose();
    controller = createRunController({
      prepared,
      clock: clockFactory(),
      plot: boundaryNow(),
      sink: {
        commit: (elements) =>
          usePlanEditorStore.setState((current) => ({
            present: { ...current.present, elements },
            clash: null,
          })),
        frame: (frame) => set({ frame }),
        select: (id) => usePlanEditorStore.getState().select(id),
        finished: (status) => finish(status, prepared, set),
      },
    });

    set({
      status: 'running',
      prepared,
      frame: null,
      refused: prepared.refused,
      compare: 'after',
      blocked: null,
      revision: null,
    });
    controller.play();
    return { ok: true };
  },

  pause: () => {
    if (get().status !== 'running') return;
    controller?.pause();
    set({ status: 'paused' });
  },

  resume: () => {
    if (get().status !== 'paused') return;
    controller?.resume();
    set({ status: 'running' });
  },

  skipToEnd: () => {
    if (get().status !== 'running' && get().status !== 'paused') return;
    controller?.skipToEnd();
  },

  cancel: () => {
    if (get().status !== 'running' && get().status !== 'paused') return;

    /*
     * Stopping a replay means "I have seen enough", not "undo the thing you are replaying".
     *
     * A replay winds the plan back before it starts, so stopping it part way would leave the garden
     * from *before* the redesign plus the first few operations of it — a state nobody asked for,
     * and one that makes Replay the only way to damage a finished redesign. Skipping to the end
     * gives the honest answer: the redesign, which is what was there before the replay began.
     */
    if (replaying) {
      controller?.skipToEnd();
      return;
    }
    controller?.cancel();
  },

  settle: () => {
    if (get().status !== 'running' && get().status !== 'paused') return;
    /*
     * Keep the work rather than throw it away. A screen going away under a run is a person
     * navigating on, not a person objecting — and the plan only ever holds finished operations, so
     * finishing the rest is the same answer they would have got by waiting.
     */
    controller?.skipToEnd();
  },

  replay: () => {
    const { revision, status } = get();
    if (!revision || status === 'running' || status === 'paused') return;

    /*
     * Only a redesign that ran to the end can be replayed. A stopped one has a revision — it needs
     * one, or "Undo to put it back" would be a lie — but its `prepared` is the *whole* timeline,
     * including the part the user stopped, so replaying it would go further than they allowed.
     */
    if (!revision.complete) return;

    const editor = usePlanEditorStore.getState();
    if (editor.present.elements !== revision.result) return;
    if (editor.gestureSnapshot !== null) return;

    /*
     * Replay puts the plan back and runs the same prepared timeline again — same bindings, so the
     * elements it adds come back with the ids they had. The sentence opens before the plan is wound
     * back and closes after the last operation, so the snapshot and the result are the same garden:
     * `endGesture` compares them, finds no difference, and writes no second undo entry.
     */
    replaying = true;
    editor.beginGesture();
    sentence = { initial: revision.result, implicit: true };
    usePlanEditorStore.setState((current) => ({
      present: { ...current.present, elements: revision.initial },
      clash: null,
    }));

    controller?.dispose();
    controller = createRunController({
      prepared: revision.prepared,
      clock: clockFactory(),
      plot: boundaryNow(),
      sink: {
        commit: (elements) =>
          usePlanEditorStore.setState((current) => ({
            present: { ...current.present, elements },
            clash: null,
          })),
        frame: (frame) => set({ frame }),
        select: (id) => usePlanEditorStore.getState().select(id),
        finished: (status) => {
          replaying = false;
          closeSentence();
          set({ status: 'complete', frame: null });
          finishWaiters(status);
        },
      },
    });

    set({ status: 'running', prepared: revision.prepared, frame: null, compare: 'after' });
    controller.play();
  },

  undoRun: () => {
    const { revision } = get();
    const editor = usePlanEditorStore.getState();
    if (!revision || editor.present.elements !== revision.result) return;

    editor.undo();
    emitDesignEvent('ai_redesign_undone', {
      delta: changedCount(revision.initial, revision.result),
    });
    set({ compare: 'after' });
  },

  toggleCompare: () =>
    set((state) =>
      state.revision ? { compare: state.compare === 'after' ? 'before' : 'after' } : state,
    ),

  beginSentence: () => {
    if (sentence) return false;
    const editor = usePlanEditorStore.getState();
    if (editor.gestureSnapshot !== null) return false;

    editor.beginGesture();
    sentence = { initial: editor.present.elements, implicit: false };
    emitDesignEvent('ai_redesign_started');
    return true;
  },

  endSentence: (request) => closeSentence(request),

  playAndWait: (run) => {
    const started = get().start(run);
    if (!started.ok) return Promise.resolve('refused' as const);
    return new Promise((resolve) => {
      settle = resolve;
    });
  },

  /**
   * The design reviewer, doing what the generator's own repair stage does — in front of the user.
   *
   * Everything it decides comes from `review-loop.ts`, which knows nothing about stores, servers or
   * canvases; this supplies the four things it cannot have: where the plan is, who can score it,
   * who can turn a fault into a diff, and how to play one. That split is what lets the gate — keep
   * the change only if the score measurably rose — be tested without any of them.
   */
  review: async (options = {}) => {
    const target = projectRevision();
    if (!target || get().reviewing || selectRunActive(get())) return null;

    set({ reviewing: true, reviewOutcome: null, blocked: null });
    try {
      /*
       * The reviewer reads the elements it is handed rather than the stored plan, so there is no
       * flush here and nothing is saved on its account. A redesign it decides to wind back should
       * leave no trace on the server at all.
       */
      const outcome = await runReviewLoop({
        elements: () => usePlanEditorStore.getState().present.elements,
        score: async (elements) => (await reviewDesign(target.projectId, elements)).score,
        propose: async (intents, elements) =>
          (await requestRedesign(target.projectId, intents, elements)).changes,
        play: (run) => get().playAndWait(run),
        undo: () => undoLastRun(),
        ...(options.subjects ? { subjects: options.subjects } : {}),
      });
      set({ reviewOutcome: outcome });
      return outcome;
    } catch {
      /*
       * A reviewer that cannot reach the server says so and changes nothing. It is an opinion about
       * the garden, not a step the user is waiting on — failing loudly here would interrupt an
       * editing session over something nobody asked for.
       */
      set({ blocked: 'The design reviewer could not be reached.' });
      return null;
    } finally {
      set({ reviewing: false });
    }
  },

  dismiss: () => set({ revision: null, refused: [], compare: 'after', blocked: null, frame: null }),
}));

/**
 * Puts the plan back to where the run that just played found it.
 *
 * Two routes, because there are two shapes of review. Asked on its own, each pass opens and closes
 * its own bracket, so there is a real undo entry and `undoRun` is the right answer. Asked as the
 * tail of a request, every pass runs inside the one sentence bracket the conversation opened —
 * nothing has reached the history stack yet, and popping it would take back an edit the user made
 * by hand before they said anything.
 *
 * Neither route emits telemetry: **the reviewer winding back its own work is not a person rejecting
 * the design**, and `design_events` is the one table in this project that records what people did.
 */
function undoLastRun(): void {
  if (sentence) {
    const initial = lastRunInitial;
    if (!initial) return;
    usePlanEditorStore.setState((current) => ({
      present: { ...current.present, elements: initial },
      clash: null,
    }));
    return;
  }

  const { revision } = useAiRunStore.getState();
  const editor = usePlanEditorStore.getState();
  if (!revision || editor.present.elements !== revision.result) return;
  editor.undo();
  useAiRunStore.setState({ compare: 'after' });
}

/**
 * Closes the sentence's bracket and reports the whole request once.
 *
 * Silent at the editor, because the sentence reports itself: `gestureChange` would either say
 * nothing (several elements moved) or — on a one-operation request — file it as a person moving a
 * shed by hand, in the one table that is supposed to record what *people* did.
 *
 * A sentence that changed nothing net emits nothing either. That is the replay case: it winds the
 * plan back and puts it right again, so there is no undo entry and no decision to record.
 */
function closeSentence(request = ''): void {
  const open = sentence;
  sentence = null;
  if (!open) return;

  const editor = usePlanEditorStore.getState();
  editor.endGesture({ silent: true });

  const result = editor.present.elements;
  const delta = changedCount(open.initial, result);
  if (delta === 0) return;

  emitDesignEvent('ai_redesign_applied', { delta });

  /*
   * The copy that outlives the tab.
   *
   * The in-session route back is the undo stack, which this sentence has just put one entry on.
   * That entry dies with the page, and a redesign autosaves within the second — so without a
   * record on the document, a request the designer misread is unrecoverable the moment the user
   * reloads. This is the whole reason it is persisted; see `DesignRevisionRecordSchema`.
   */
  usePlanEditorStore.getState().recordRevision({
    id: `r-${open.initial.length}-${Date.now().toString(36)}`,
    request,
    createdAt: Date.now(),
    before: open.initial,
    afterFingerprint: layoutFingerprint(result),
  });
}

/**
 * Records what a run left behind, and closes the sentence if the run opened it.
 *
 * The revision spans the **sentence**, not the run: `initial` is the garden before the request, so
 * Compare after a reviewer's correction still shows what the user had before they asked, rather
 * than what they had before the reviewer's last tweak.
 *
 * **A stopped run writes a revision too**, and that is not a detail. Stop keeps what has landed, so
 * without a revision `undoRun` returns early and the panel's "Stopped after layout. Undo to put it
 * back" would be a sentence the product cannot honour. `complete: false` is what stops Replay
 * offering to run the part the user stopped.
 */
function finish(
  status: 'complete' | 'cancelled',
  prepared: PreparedRun,
  set: (partial: Partial<AiRunState>) => void,
): void {
  const initial = sentence?.initial ?? prepared.initial;
  const result = usePlanEditorStore.getState().present.elements;

  if (status === 'cancelled') emitDesignEvent('ai_redesign_cancelled');

  set({
    status: status === 'cancelled' ? 'cancelled' : 'complete',
    frame: null,
    refused: prepared.refused,
    revision: {
      id: prepared.run.id,
      request: prepared.run.request,
      createdAt: Date.now(),
      prepared,
      initial,
      result,
      refused: prepared.refused,
      summary: prepared.run.summary ?? null,
      complete: status === 'complete',
    },
  });

  if (sentence?.implicit) closeSentence(prepared.run.request);
  finishWaiters(status);
}

/** Whether the AI currently has the plan, which is what locks the editor's own tools. */
export function selectRunActive(state: AiRunState): boolean {
  return state.status === 'running' || state.status === 'paused';
}

/** For tests: forget everything, including the live controller. */
export function resetAiRunStoreForTests(): void {
  controller?.dispose();
  controller = null;
  replaying = false;
  clockFactory = browserClock;
  sentence = null;
  lastRunInitial = null;
  finishWaiters('cancelled');
  useAiRunStore.setState({
    status: 'idle',
    prepared: null,
    frame: null,
    refused: [],
    compare: 'after',
    revision: null,
    blocked: null,
    reviewing: false,
    reviewOutcome: null,
  });
}
