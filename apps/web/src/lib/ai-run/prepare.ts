import {
  DEFAULT_DURATION,
  DEFAULT_PAUSE,
  applyResolved,
  resolveOperation,
  type DesignElement,
  type DesignOperation,
  type DesignRun,
  type LeafOperation,
  type Point,
  type ResolvedOperation,
  type RunPhase,
} from '@garden-studio/schema';

/**
 * A run, turned from a script into a timeline — and checked before a pixel of it is drawn.
 *
 * Two jobs, and the second is the one that matters. Compiling relative times into absolute ones is
 * bookkeeping. **Resolving every operation up front, against the state it will actually land on, is
 * what stops the animation lying**: an operation the plan would refuse is given no time on the
 * timeline and reported in the panel instead, so the canvas can never show a change the store then
 * declines to keep. The alternative — animate first, apply at the end, discover the refusal — would
 * make the feature untrustworthy in exactly the way a design tool cannot afford.
 *
 * Deterministic all through: the same script, the same starting plan and the same id allocator
 * produce the same timeline, which is what makes Replay a re-run rather than a recording.
 */

export interface CompiledLeaf {
  operation: LeafOperation;
  start: number;
  end: number;
  outcome: ResolvedOperation;
  /** The element as it was when this operation starts, for anything that has to animate from it. */
  before: DesignElement | null;
}

export interface CompiledOperation {
  operation: DesignOperation;
  index: number;
  start: number;
  end: number;
  leaves: CompiledLeaf[];
  /** Every element once this operation and its children have landed. */
  stateAfter: DesignElement[];
}

export interface PreparedRun {
  run: DesignRun;
  initial: DesignElement[];
  operations: CompiledOperation[];
  /** `$ref` → the id allocated for it, kept so a replay reproduces the same plan exactly. */
  bindings: Record<string, string>;
  refused: { operationId: string; label: string; reason: string }[];
  /** Milliseconds from the first operation to the last. */
  total: number;
  phases: { phase: RunPhase; start: number; end: number }[];
  /** The plan the run ends on, which is what the last operation commits. */
  result: DesignElement[];
}

export interface PrepareContext {
  boundary: Point[];
  /** Hands out real element ids. The editor's own allocator, so ids stay `e-N` and re-seed on load. */
  allocateId: () => string;
}

/** Every `$ref` an `add` introduces, bound in operation order so a replay binds them the same way. */
function bindReferences(
  operations: DesignOperation[],
  allocateId: () => string,
): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const operation of operations)
    for (const leaf of operation.kind === 'group' ? operation.children : [operation])
      if (leaf.kind === 'add' && !bindings[leaf.ref]) bindings[leaf.ref] = allocateId();
  return bindings;
}

/**
 * How long a run may take before it stops being something to watch.
 *
 * Twenty-five seconds is about the limit of watching a thing happen without starting to wonder
 * whether it has hung — and the vocabulary now allows twelve intents in one request, which
 * legitimately compiles to more than that. Skip is always there, but a control the user has to
 * reach for because the default pacing is wrong is a default that is wrong.
 */
export const MAX_RUN_MS = 25_000;

/**
 * Squeezes a long run into the cap.
 *
 * **Scaled uniformly, not truncated.** Zeroing the tail was the first design and it is worse in two
 * ways: it collapses several operations onto the same instant, where nothing guarantees the order
 * they are drawn in reads as anything, and it makes the last thing the user sees a jump — which is
 * exactly the "spinner then a jump" this whole feature exists to replace. Scaling preserves every
 * ordering and every gap in proportion; a forty-second run simply plays at 1.6×.
 *
 * Returns the operations untouched when the run already fits, which is the overwhelming majority:
 * the demonstration and any one-or-two-change request come in well under.
 */
function withinBudget(operations: CompiledOperation[], budget: number): CompiledOperation[] {
  const total = operations.reduce((latest, operation) => Math.max(latest, operation.end), 0);
  if (total <= budget) return operations;

  const scale = budget / total;
  return operations.map((operation) => ({
    ...operation,
    start: operation.start * scale,
    end: operation.end * scale,
    leaves: operation.leaves.map((leaf) => ({
      ...leaf,
      start: leaf.start * scale,
      end: leaf.end * scale,
    })),
  }));
}

export function prepareRun(
  run: DesignRun,
  initial: DesignElement[],
  context: PrepareContext,
): PreparedRun {
  const bindings = bindReferences(run.operations, context.allocateId);
  const refused: PreparedRun['refused'] = [];
  const operations: CompiledOperation[] = [];

  let elements = initial;
  let cursor = 0;

  run.operations.forEach((operation, index) => {
    const children = operation.kind === 'group' ? operation.children : [operation];
    const stagger = operation.kind === 'group' ? operation.stagger : 0;
    const leaves: CompiledLeaf[] = [];

    children.forEach((leaf, childIndex) => {
      /*
       * Children resolve in array order even though they run together. It only shows when two of
       * them touch the same element, which is an authoring mistake — and "the second sees the
       * first's result" is the only reading of that which cannot produce a state nobody asked for.
       */
      const before =
        'elementId' in leaf
          ? (elements.find((element) => {
              const ref = leaf.elementId;
              return element.id === (ref.startsWith('$') ? bindings[ref] : ref);
            }) ?? null)
          : null;

      const outcome = resolveOperation(leaf, { elements, boundary: context.boundary, bindings });
      if (!outcome.ok) refused.push({ operationId: leaf.id, label: leaf.label, reason: outcome.reason });

      elements = applyResolved(elements, outcome);

      /* A refused operation takes no time: there is nothing honest to show for it. */
      const duration = outcome.ok ? (leaf.duration ?? DEFAULT_DURATION[leaf.kind]) : 0;
      const start = cursor + childIndex * stagger;
      leaves.push({ operation: leaf, start, end: start + duration, outcome, before });
    });

    /*
     * An operation lasts as long as its slowest child, or as long as its author said, whichever is
     * longer. An operation every part of which was refused takes no time at all and adds no pause
     * after itself, so a run whose script has gone stale plays through rather than sitting in
     * silence in front of the user.
     */
    const natural = leaves.reduce((latest, leaf) => Math.max(latest, leaf.end), cursor);
    const end = Math.max(natural, operation.duration === undefined ? natural : cursor + operation.duration);

    operations.push({ operation, index, start: cursor, end, leaves, stateAfter: elements });
    cursor = end === cursor ? cursor : end + (operation.pauseAfter ?? DEFAULT_PAUSE);
  });

  const paced = withinBudget(operations, MAX_RUN_MS);

  return {
    run,
    initial,
    operations: paced,
    bindings,
    refused,
    total: paced.reduce((latest, operation) => Math.max(latest, operation.end), 0),
    phases: phaseSpans(paced),
    result: elements,
  };
}

/** Where each stage begins and ends, for the strip that narrates the run. */
function phaseSpans(operations: CompiledOperation[]): PreparedRun['phases'] {
  const spans: PreparedRun['phases'] = [];
  for (const operation of operations) {
    const phase = operation.operation.phase;
    const last = spans[spans.length - 1];
    if (last && last.phase === phase) last.end = Math.max(last.end, operation.end);
    else spans.push({ phase, start: operation.start, end: operation.end });
  }
  return spans;
}

/** Whether anything in the run actually changed the plan. */
export function changesAnything(prepared: PreparedRun): boolean {
  return prepared.result !== prepared.initial;
}
