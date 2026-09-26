import { anchorFor, sideChains, spanOfRun, type SideChain } from '../boundary/side-chains.js';
import type { BoundaryInterval } from '../boundary/graph.js';
import {
  nextEdgeRunId,
  type EdgeRun,
  type EdgeSource,
  type EdgeTreatmentPlan,
} from './edge-run.js';

import { edgePlanOf, type EdgeResolution } from './resolve.js';
import { MIN_EDGE_RUN_LENGTH, treatmentSpec, type EdgeDimension, type EdgeTreatment } from './treatments.js';
import type { DesignElement } from '../concepts.js';

/**
 * Every way a boundary treatment can be changed, as pure functions of an element.
 *
 * **One path for people and for the designer.** The editor's store wraps these in its undo
 * bracket and the assistant's planner calls them to build a proposal, so a run the user drags and a
 * run the designer lays are made by the same code and obey the same limits. There is no second
 * implementation of "what happens when an end is dragged past the next run" to drift from the first.
 *
 * Each returns a new element, or `null` for a change that is refused — a run dragged shorter than
 * `MIN_EDGE_RUN_LENGTH`, a side the shape does not have. Refusing rather than clamping is the rule
 * every drag in this editor follows: a limit the user can see beats a drag that silently stops
 * tracking.
 */

type Mode = EdgeTreatmentPlan['mode'];

/* ---------------------------------------------------------------- modes */

/**
 * The runs a surface in `auto` mode is showing, as stored runs — which is what entering Custom
 * writes, so switching modes changes nothing on screen.
 *
 * Two sources, and the second is the one that is easy to miss. The host's own resolved runs, and
 * any join a *neighbour* was drawing along a seam the two share: ownership gives each seam to one
 * side, so a patio whose flush join to the path is drawn by the path has no run there of its own.
 * Taking Custom claims every seam the patio takes part in, so without carrying the neighbour's join
 * across it would disappear the moment the user asked to edit it.
 */
export function materialisedRuns(
  elements: DesignElement[],
  hostId: string,
  resolution: EdgeResolution,
): EdgeRun[] {
  const host = elements.find((element) => element.id === hostId);
  if (!host) return [];

  const chains = resolution.graph.chainsOf(hostId);
  const runs: EdgeRun[] = [];

  const push = (side: number, from: number, to: number, treatment: EdgeTreatment, materialId: string | null) => {
    const chain = chains[side];
    if (!chain || to - from < MIN_EDGE_RUN_LENGTH) return;
    runs.push({
      id: nextEdgeRunId(runs),
      side,
      ...anchorFor(chain, from, to),
      treatment,
      ...(materialId ? { materialId } : {}),
      source: 'auto',
    });
  };

  for (const run of resolution.runs) {
    if (run.hostId === hostId) push(run.side, run.from, run.to, run.treatment, run.materialId);
  }

  for (const interval of resolution.graph.intervalsOf(hostId)) {
    const { neighbour } = interval;
    if (neighbour.kind !== 'element') continue;
    const across = resolution.runs.find(
      (run) => run.hostId === neighbour.id && run.neighbour?.kind === 'element' && run.neighbour.id === hostId,
    );
    if (across) push(interval.side, interval.from, interval.to, across.treatment, across.materialId);
  }

  return runs.sort((a, b) => a.side - b.side || startOf(chains, a) - startOf(chains, b));
}

/**
 * Change how a surface's boundary is decided.
 *
 * - **custom** from auto takes the automatic answer as its starting point (`materialised`); from
 *   none it takes back whatever runs None was set aside over, so Custom → None → Custom restores
 *   the user's own work rather than throwing it away.
 * - **none** keeps the runs, unread, for exactly that round trip.
 * - **auto** discards them: "decide for me" has nothing to remember.
 */
export function withEdgeMode(element: DesignElement, mode: Mode, materialised: EdgeRun[]): DesignElement {
  const plan = edgePlanOf(element);
  if (plan.mode === mode) return element;

  if (mode === 'auto') return { ...element, edges: { mode: 'auto', runs: [] } };
  if (mode === 'none') return { ...element, edges: { mode: 'none', runs: plan.runs } };

  const runs = plan.mode === 'none' && plan.runs.length > 0 ? plan.runs : materialised;
  return { ...element, edges: { mode: 'custom', runs } };
}

/* ---------------------------------------------------------------- runs */

/**
 * Where a new run should go when the user asks for one at a point on a side.
 *
 * The stretch of the boundary graph under the pointer — "where this meets the lawn" rather than an
 * arbitrary two metres — less anything already covered by a run on that side. So a click on the
 * lawn edge of a patio makes a run covering exactly the lawn edge, and a click in a gap between two
 * runs fills exactly the gap. `null` over an existing run, which the caller reads as "select that".
 */
export function freeSpanAt(
  element: DesignElement,
  intervals: BoundaryInterval[],
  side: number,
  distance: number,
): { from: number; to: number } | null {
  const chain = sideChains(element.shape)[side];
  if (!chain) return null;

  const interval = intervals.find(
    (candidate) => candidate.side === side && distance >= candidate.from && distance <= candidate.to,
  );
  let from = interval?.from ?? 0;
  let to = interval?.to ?? chain.length;

  for (const span of storedSpans(element, chain)) {
    if (distance >= span.from && distance <= span.to) return null;
    if (span.to <= distance) from = Math.max(from, span.to);
    if (span.from >= distance) to = Math.min(to, span.from);
  }

  return to - from < MIN_EDGE_RUN_LENGTH ? null : { from, to };
}

/** A new run over a span, with the treatment given. Returns the element and the run's id. */
export function withRunAdded(
  element: DesignElement,
  side: number,
  span: { from: number; to: number },
  treatment: EdgeTreatment,
  source: EdgeSource,
  materialId?: string,
): { element: DesignElement; runId: string } | null {
  const chain = sideChains(element.shape)[side];
  if (!chain || span.to - span.from < MIN_EDGE_RUN_LENGTH) return null;

  const plan = edgePlanOf(element);
  const runs = plan.mode === 'custom' ? plan.runs : [];
  const runId = nextEdgeRunId(runs);
  const run: EdgeRun = {
    id: runId,
    side,
    ...anchorFor(chain, span.from, span.to),
    treatment,
    ...(materialId ? { materialId } : {}),
    source,
  };

  return { element: { ...element, edges: { mode: 'custom', runs: [...runs, run] } }, runId };
}

/**
 * Drag one end of a run along its side.
 *
 * The dragged end follows the pointer's distance; the other end holds. Clamped to the side and to
 * the neighbouring runs on it, so two runs can meet but never overlap — two courses on one stretch
 * would be drawn twice and ordered twice. Refused under the minimum length rather than pinned to
 * it, for the reason at the top of this file.
 *
 * The run is re-anchored to whichever end it is now nearer, which is what keeps "metres from the
 * nearer end" true after the user has moved it.
 */
export function withRunEnd(
  element: DesignElement,
  runId: string,
  end: 'from' | 'to',
  distance: number,
): DesignElement | null {
  const plan = edgePlanOf(element);
  const run = plan.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  const chain = sideChains(element.shape)[run.side];
  if (!chain) return null;
  const span = spanOfRun(chain, run);
  if (!span) return null;

  const others = plan.runs
    .filter((other) => other.id !== runId && other.side === run.side)
    .map((other) => spanOfRun(chain, other))
    .filter((other): other is { from: number; to: number } => other !== null);

  const floor = Math.max(0, ...others.filter((other) => other.to <= span.from + 1e-9).map((other) => other.to));
  const ceiling = Math.min(chain.length, ...others.filter((other) => other.from >= span.to - 1e-9).map((other) => other.from));

  const next =
    end === 'from'
      ? { from: Math.max(floor, Math.min(distance, span.to)), to: span.to }
      : { from: span.from, to: Math.min(ceiling, Math.max(distance, span.from)) };

  if (next.to - next.from < MIN_EDGE_RUN_LENGTH) return null;

  return withRun(element, runId, (current) => ({
    ...current,
    ...anchorFor(chain, next.from, next.to),
    source: 'user',
  }));
}

export function withRunTreatment(
  element: DesignElement,
  runId: string,
  treatment: EdgeTreatment,
  source: EdgeSource,
): DesignElement | null {
  return withRun(element, runId, (run) => {
    // A new treatment starts from its own defaults: a brick's width means nothing on steel.
    const { materialId: _material, widthMm: _width, heightMm: _height, ...rest } = run;
    return { ...rest, treatment, source };
  });
}

/**
 * Set or clear one dimension of a run. `null` clears it back to the product's default.
 *
 * A dimension the treatment does not have is refused rather than stored: a height on a flush join
 * would be a number that changes nothing, and one that would reappear the day the join became a
 * kerb.
 */
export function withRunDimension(
  element: DesignElement,
  runId: string,
  dimension: EdgeDimension,
  millimetres: number | null,
  source: EdgeSource,
): DesignElement | null {
  const key = dimension === 'width' ? 'widthMm' : 'heightMm';

  return withRun(element, runId, (run) => {
    if (!treatmentSpec(run.treatment).dims.includes(dimension)) return run;
    const { [key]: _dropped, ...rest } = run;
    return millimetres === null || !(millimetres > 0)
      ? { ...rest, source }
      : { ...rest, [key]: millimetres, source };
  });
}

/**
 * Give one stretch of a side a treatment, whatever was there before.
 *
 * What the assistant does with "brick along the lawn side" or "no edging where it meets the path":
 * every run on that side is trimmed back out of the stretch — split in two where the stretch falls
 * in its middle, each half keeping its own treatment and its own end — and then, unless the answer
 * is `none`, one new run covers the stretch exactly. Pieces left shorter than a run can be are
 * dropped rather than kept as slivers.
 *
 * Requires a host already in `custom` mode, so the caller has materialised what Auto was showing
 * and the trim is applied to what the user could see.
 */
export function withStretch(
  element: DesignElement,
  side: number,
  stretch: { from: number; to: number },
  treatment: EdgeTreatment,
  source: EdgeSource,
): DesignElement | null {
  const chain = sideChains(element.shape)[side];
  const plan = edgePlanOf(element);
  if (!chain || plan.mode !== 'custom') return null;

  const kept: EdgeRun[] = [];
  const keep = (run: EdgeRun, from: number, to: number, fresh: boolean) => {
    if (to - from < MIN_EDGE_RUN_LENGTH) return;
    kept.push({ ...run, ...(fresh ? { id: nextEdgeRunId([...plan.runs, ...kept]) } : {}), ...anchorFor(chain, from, to) });
  };

  for (const run of plan.runs) {
    const span = run.side === side ? spanOfRun(chain, run) : null;
    if (!span || span.to <= stretch.from || span.from >= stretch.to) {
      kept.push(run);
      continue;
    }
    keep(run, span.from, Math.min(span.to, stretch.from), false);
    keep(run, Math.max(span.from, stretch.to), span.to, span.from < stretch.from);
  }

  if (treatment !== 'none' && stretch.to - stretch.from >= MIN_EDGE_RUN_LENGTH) {
    kept.push({
      id: nextEdgeRunId([...plan.runs, ...kept]),
      side,
      ...anchorFor(chain, stretch.from, stretch.to),
      treatment,
      source,
    });
  }

  return { ...element, edges: { mode: 'custom', runs: kept } };
}

export function withoutRun(element: DesignElement, runId: string): DesignElement | null {
  const plan = edgePlanOf(element);
  if (!plan.runs.some((run) => run.id === runId)) return null;
  return { ...element, edges: { ...plan, runs: plan.runs.filter((run) => run.id !== runId) } };
}

/* ---------------------------------------------------------------- internals */

function withRun(
  element: DesignElement,
  runId: string,
  change: (run: EdgeRun) => EdgeRun,
): DesignElement | null {
  const plan = edgePlanOf(element);
  const index = plan.runs.findIndex((run) => run.id === runId);
  if (index < 0) return null;

  const runs = [...plan.runs];
  runs[index] = change(runs[index]!);
  return { ...element, edges: { ...plan, runs } };
}

function storedSpans(element: DesignElement, chain: SideChain): { from: number; to: number }[] {
  const plan = edgePlanOf(element);
  if (plan.mode !== 'custom') return [];
  return plan.runs
    .filter((run) => run.side === chain.side)
    .map((run) => spanOfRun(chain, run))
    .filter((span): span is { from: number; to: number } => span !== null);
}

function startOf(chains: SideChain[], run: EdgeRun): number {
  const chain = chains[run.side];
  return chain ? (spanOfRun(chain, run)?.from ?? 0) : 0;
}
