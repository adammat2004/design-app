'use client';

import { create } from 'zustand';
import type { DesignElement, DesignRun, Point } from '@garden-studio/schema';
import { browserClock, type Clock } from '@/lib/ai-run/clock';
import { createRunController, type RunController } from '@/lib/ai-run/controller';
import type { RunFrame } from '@/lib/ai-run/evaluate';
import { prepareRun, type PreparedRun } from '@/lib/ai-run/prepare';
import { draftPolygon } from '@/lib/boundary-geometry';
import { useBoundaryStore } from './boundary-store';
import { emitDesignEvent } from './design-events';
import { allocateElementId, usePlanEditorStore } from './plan-editor-store';

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

  start: (run: DesignRun) => { ok: true } | { ok: false; reason: string };
  pause: () => void;
  resume: () => void;
  skipToEnd: () => void;
  cancel: () => void;
  replay: () => void;
  undoRun: () => void;
  toggleCompare: () => void;
  dismiss: () => void;
  /** Ends any run immediately, keeping its work. For a screen going away under it. */
  settle: () => void;
}

/** The controller is a live object with a frame loop; it has no business in a store snapshot. */
let controller: RunController | null = null;
let replaying = false;

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
        finished: () => {
          usePlanEditorStore.getState().endGesture({ silent: true });
          replaying = false;
          set({ status: 'complete', frame: null });
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
  useAiRunStore.setState({
    status: 'idle',
    prepared: null,
    frame: null,
    refused: [],
    compare: 'after',
    revision: null,
    blocked: null,
  });
}
