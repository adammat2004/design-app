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
  /** Plays a run and resolves when it ends. What the review loop is built on. */
  playAndWait: (run: DesignRun) => Promise<'complete' | 'cancelled' | 'refused'>;
  /** The design reviewer: read the plan, fix the worst thing it can, keep it only if it helped. */
  review: () => Promise<void>;
  /** Ends any run immediately, keeping its work. For a screen going away under it. */
  settle: () => void;
}

/** The controller is a live object with a frame loop; it has no business in a store snapshot. */
let controller: RunController | null = null;
let replaying = false;

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
    if (editor.gestureSnapshot !== null) {
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

    editor.beginGesture();
    emitDesignEvent('ai_redesign_started');

    controller?.dispose();
    controller = createRunController({
      prepared,
      clock: clockFactory(),
      plot: boundaryNow(),
      restoreTo: replaying ? get().revision?.result ?? initial : initial,
      sink: {
        commit: (elements) =>
          usePlanEditorStore.setState((current) => ({
            present: { ...current.present, elements },
            clash: null,
          })),
        frame: (frame) => set({ frame }),
        select: (id) => usePlanEditorStore.getState().select(id),
        finished: (status) => finish(status, prepared, initial, set),
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

    const editor = usePlanEditorStore.getState();
    if (editor.present.elements !== revision.result) return;

    /*
     * Replay puts the plan back and runs the same prepared timeline again — same bindings, so the
     * elements it adds come back with the ids they had. The bracket opens before the plan is wound
     * back and closes after the last operation, so the snapshot and the result are the same
     * garden: `endGesture` compares them, finds no difference, and writes no second undo entry.
     */
    replaying = true;
    editor.beginGesture();
    usePlanEditorStore.setState((current) => ({
      present: { ...current.present, elements: revision.initial },
      clash: null,
    }));

    controller?.dispose();
    controller = createRunController({
      prepared: revision.prepared,
      clock: clockFactory(),
      plot: boundaryNow(),
      /* Stopping a replay half way must leave the redesign, not the garden before it. */
      restoreTo: revision.result,
      sink: {
        commit: (elements) =>
          usePlanEditorStore.setState((current) => ({
            present: { ...current.present, elements },
            clash: null,
          })),
        frame: (frame) => set({ frame }),
        select: (id) => usePlanEditorStore.getState().select(id),
        finished: (status) => {
          usePlanEditorStore.getState().endGesture({ silent: true });
          replaying = false;
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
  review: async () => {
    const target = projectRevision();
    if (!target || get().reviewing || selectRunActive(get())) return;

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
        undo: () => get().undoRun(),
      });
      set({ reviewOutcome: outcome });
    } catch {
      /*
       * A reviewer that cannot reach the server says so and changes nothing. It is an opinion about
       * the garden, not a step the user is waiting on — failing loudly here would interrupt an
       * editing session over something nobody asked for.
       */
      set({ blocked: 'The design reviewer could not be reached.' });
    } finally {
      set({ reviewing: false });
    }
  },

  dismiss: () => set({ revision: null, refused: [], compare: 'after', blocked: null, frame: null }),
}));

/** Closes the bracket, records what happened, and leaves something to compare and replay. */
function finish(
  status: 'complete' | 'cancelled',
  prepared: PreparedRun,
  initial: DesignElement[],
  set: (partial: Partial<AiRunState>) => void,
): void {
  /*
   * One `endGesture` for the whole run, silent because the run reports itself. A cancelled run put
   * the plan back first, so `sameElements` is true and no undo entry is written at all — stopping
   * leaves no trace, which is what "stop" should mean.
   */
  usePlanEditorStore.getState().endGesture({ silent: true });

  if (status === 'cancelled') {
    emitDesignEvent('ai_redesign_cancelled');
    set({ status: 'cancelled', frame: null, revision: null });
    finishWaiters('cancelled');
    return;
  }

  const result = usePlanEditorStore.getState().present.elements;
  emitDesignEvent('ai_redesign_applied', { delta: changedCount(initial, result) });

  set({
    status: 'complete',
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
    },
  });
  finishWaiters('complete');
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
