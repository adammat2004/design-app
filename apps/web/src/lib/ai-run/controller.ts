import type { DesignElement, Point } from '@garden-studio/schema';
import type { Clock } from './clock';
import { evaluateRun, type RunFrame } from './evaluate';
import type { PreparedRun } from './prepare';

/**
 * The thing that turns a timeline into a run.
 *
 * It owns exactly two decisions and nothing else: when to hand the plan its next settled state, and
 * what the overlay layer should draw this frame. Everything about *what* the run does was settled at
 * prepare time, and everything about how it looks is `evaluateRun` — so this file has no geometry in
 * it at all, which is what keeps the reasoning, the motion and the store from growing into each
 * other.
 *
 * Pausing is an offset rather than a stopped clock. A stopped clock is the easy version and it
 * drifts: `performance.now()` keeps moving while the run is paused, so anything that reads it after
 * a resume jumps forward by however long the user was thinking.
 */

export interface RunSink {
  /** A new settled plan, at an operation boundary. The one place the store is written. */
  commit(elements: DesignElement[], operationIndex: number): void;
  /** This frame's overlays and motion. Called every frame while playing. */
  frame(frame: RunFrame): void;
  /** Selection follows the agent, so the properties panel shows what is being worked on. */
  select(elementId: string | null): void;
  finished(status: 'complete' | 'cancelled'): void;
}

export interface RunController {
  play(): void;
  pause(): void;
  resume(): void;
  /** Applies everything remaining at once. Still only pre-resolved results. */
  skipToEnd(): void;
  /** Puts the plan back the way it was found and stops. */
  cancel(): void;
  seek(t: number): void;
  elapsed(): number;
  isPlaying(): boolean;
  dispose(): void;
}

export interface ControllerOptions {
  prepared: PreparedRun;
  clock: Clock;
  sink: RunSink;
  plot?: Point[];
}

export function createRunController({
  prepared,
  clock,
  sink,
  plot = [],
}: ControllerOptions): RunController {
  let elapsed = 0;
  let startedAt: number | null = null;
  let cancelFrame: (() => void) | null = null;
  let committed = 0;
  let finished = false;

  const now = () => (startedAt === null ? elapsed : elapsed + (clock.now() - startedAt));

  function emit(t: number): void {
    const frame = evaluateRun(prepared, t, plot);

    /*
     * Catch up rather than step: a tab that was in the background for a second must still apply the
     * three operations it slept through, and in order, or the plan ends up in a state the run never
     * described.
     */
    while (committed < frame.settledIndex) {
      const operation = prepared.operations[committed]!;
      committed += 1;
      sink.commit(operation.stateAfter, operation.index);
    }

    const selecting = prepared.operations.find(
      (operation) => t >= operation.start && t <= operation.end,
    );
    if (selecting) {
      const leaf = selecting.leaves.find(
        (candidate) => candidate.outcome.ok && 'elementId' in candidate.operation,
      );
      const ref = leaf && 'elementId' in leaf.operation ? leaf.operation.elementId : null;
      const id = ref ? (ref.startsWith('$') ? (prepared.bindings[ref] ?? null) : ref) : null;
      sink.select(id);
    }

    sink.frame(frame);
  }

  function step(): void {
    if (finished) return;
    const t = now();
    emit(t);

    if (t >= prepared.total) {
      stop('complete');
      return;
    }
    cancelFrame = clock.frame(step);
  }

  function stop(status: 'complete' | 'cancelled'): void {
    if (finished) return;
    finished = true;
    cancelFrame?.();
    cancelFrame = null;
    startedAt = null;
    sink.select(null);
    sink.finished(status);
  }

  return {
    play() {
      if (finished || startedAt !== null) return;
      startedAt = clock.now();
      /* One synchronous frame so the first operation's overlay is up before the first repaint. */
      emit(now());
      cancelFrame = clock.frame(step);
    },

    pause() {
      if (finished || startedAt === null) return;
      elapsed = now();
      startedAt = null;
      cancelFrame?.();
      cancelFrame = null;
    },

    resume() {
      if (finished || startedAt !== null) return;
      startedAt = clock.now();
      cancelFrame = clock.frame(step);
    },

    skipToEnd() {
      if (finished) return;
      elapsed = prepared.total;
      startedAt = null;
      cancelFrame?.();
      cancelFrame = null;
      emit(prepared.total);
      stop('complete');
    },

    /**
     * Stops where it is, and **keeps what has landed**.
     *
     * It used to restore the run's starting point, which reads as the safer answer and is the worse
     * one: a Stop that discards teaches people not to press it, so they let a run they have already
     * seen enough of play to the end and undo it afterwards. In a conversation "stop, I like the
     * layout, leave the planting" is the ordinary thing to mean.
     *
     * Only settled operations are in the plan — the executor commits at boundaries — so what stays
     * is a garden the run actually described, never a half-applied one. Going back is Undo's job,
     * and the store writes the revision that makes Undo possible.
     */
    cancel() {
      if (finished) return;
      cancelFrame?.();
      cancelFrame = null;
      startedAt = null;
      sink.frame({ ...evaluateRun(prepared, 0, plot), motion: [], overlays: [], suppress: [], cursor: null, chip: null });
      stop('cancelled');
    },

    seek(t) {
      elapsed = Math.max(0, Math.min(t, prepared.total));
      if (startedAt !== null) startedAt = clock.now();
      emit(elapsed);
    },

    elapsed: () => now(),
    isPlaying: () => startedAt !== null && !finished,

    dispose() {
      cancelFrame?.();
      cancelFrame = null;
      finished = true;
    },
  };
}
