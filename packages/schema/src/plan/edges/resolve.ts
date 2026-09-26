import type { Point } from '../../geometry/primitives.js';
import { geometryOutline } from '../features.js';
import { edgingHeight } from '../heights.js';
import { defaultMaterial } from '../materials.js';
import {
  buildBoundaryGraph,
  isGround,
  type BoundaryContext,
  type BoundaryGraph,
  type BoundaryInterval,
  type Neighbour,
} from '../boundary/graph.js';
import { nearestSide, runPolyline, spanOfRun } from '../boundary/side-chains.js';
import { AUTO_EDGES, type EdgeSource, type EdgeTreatmentPlan } from './edge-run.js';
import { recommendTreatment, seamOwner, type EdgeRuleContext } from './rules.js';
import {
  edgingWidthMetres,
  FLUSH_WIDTH_MM,
  treatmentIsDrawn,
  treatmentSpec,
  type EdgeTreatment,
} from './treatments.js';
import type { DesignElement } from '../concepts.js';

/**
 * Every boundary treatment on the plan, resolved to geometry.
 *
 * One function, four consumers: the renderer draws these and nothing else, the inspector lists
 * them, the schedule counts them by the metre, and the assistant's planner edits them. Anything
 * that wanted to know where edging goes used to call `edgingRuns`, which decided the question
 * privately and could only answer "whole sides"; this answers stretches, and says why.
 *
 * **Nothing here is stored.** A run is a side index and two distances; this turns that into a
 * polyline against the shape's *current* outline, every read — the way a door resolves through
 * `housePolygon` and a zone through `computeZones`. Delete this file and the plan is dimensionally
 * identical and merely plainer.
 *
 * ## One seam, one thing built
 *
 * Two surfaces that meet share a join, and a join is built once however many surfaces touch it —
 * so a pair of elements is resolved once, and the loser draws nothing there. Who wins:
 *
 * 1. **A host the user has taken charge of claims its seams outright.** A surface in `custom` or
 *    `none` mode owns every join it takes part in, whether or not it put a run there, so a
 *    neighbour cannot quietly put back an edge somebody has just removed. This is what makes
 *    "None" mean none rather than "none from this side".
 * 2. **Otherwise whichever side actually wants to build something**, which is usually only one of
 *    them — a patio meeting a bed wants a course, and the bed meeting the patio does not.
 * 3. **Otherwise `seamOwner`**, by category, so the answer never depends on element order.
 */

export interface ResolvedEdgeRun {
  /**
   * Stable across renders: the host's id, its side, and the run's own id or the stretch's start.
   * It keys the raster cache and the seeded tones, so a course keeps its identity while the bed it
   * follows is merely selected or renamed.
   */
  id: string;
  hostId: string;
  /** The stored run this came from, where there is one. Null for an automatic stretch. */
  runId: string | null;
  side: number;
  /** Metres along the side chain, from its start — what the editor's handles sit on. */
  from: number;
  to: number;
  /** World metres. Follows the host's curves, because it is cut from the host's own outline. */
  points: Point[];
  length: number;
  treatment: EdgeTreatment;
  /** A `MaterialId`, or null where the treatment names no product. */
  materialId: string | null;
  widthM: number;
  /** Zero for anything that does not stand proud, which is what keeps it out of the elevated stack. */
  heightM: number;
  neighbour: Neighbour | null;
  source: EdgeSource;
  why?: string;
}

export interface EdgeResolution {
  runs: ResolvedEdgeRun[];
  graph: BoundaryGraph;
}

export function edgePlanOf(element: DesignElement): EdgeTreatmentPlan {
  return element.edges ?? AUTO_EDGES;
}

/**
 * Resolve every host's boundary treatments.
 *
 * `context` is the geometry a stretch may lie *on* — the boundary ring and the house footprint.
 * Both are optional and default to no exclusion, because a caller with neither (a thumbnail, a
 * unit test) should get the honest whole-outline answer rather than a silently different one.
 */
export function resolveEdges(
  elements: DesignElement[],
  context: BoundaryContext = {},
  rules: EdgeRuleContext = { style: null, budget: null, maintenance: null },
): EdgeResolution {
  const graph = buildBoundaryGraph(elements, context);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const claimed = new Set<string>();
  const runs: ResolvedEdgeRun[] = [];

  /* ---- 1. the user's own runs, which claim the seams they touch ---- */

  for (const element of elements) {
    if (!isGround(element)) continue;
    const plan = edgePlanOf(element);
    if (plan.mode === 'auto') continue;

    // `custom` and `none` alike: this surface's joins are the user's to decide.
    for (const interval of graph.intervalsOf(element.id)) {
      if (interval.neighbour.kind === 'element') {
        claimed.add(seamKey(element.id, interval.neighbour.id));
      }
    }

    if (plan.mode === 'none') continue;

    const chains = graph.chainsOf(element.id);
    for (const run of plan.runs) {
      const chain = chains[run.side];
      if (!chain) continue;
      const span = spanOfRun(chain, run);
      if (!span) continue;
      if (!treatmentIsDrawn(run.treatment)) continue;

      const points = runPolyline(chain, span.from, span.to);
      if (points.length < 2) continue;

      runs.push(
        materialise({
          id: `${element.id}:edge:${run.side}:${run.id}`,
          hostId: element.id,
          runId: run.id,
          side: run.side,
          from: span.from,
          to: span.to,
          points,
          length: span.to - span.from,
          treatment: run.treatment,
          materialId: run.materialId ?? null,
          widthMm: run.widthMm,
          heightMm: run.heightMm,
          neighbour: neighbourAt(graph, element.id, run.side, (span.from + span.to) / 2),
          source: run.source,
        }),
      );
    }
  }

  /* ---- 2. what the rules would build, where nobody has claimed it ---- */

  const proposals = new Map<string, { interval: BoundaryInterval; recommendation: ReturnType<typeof recommendTreatment> }[]>();

  for (const element of elements) {
    if (!isGround(element)) continue;
    if (edgePlanOf(element).mode !== 'auto') continue;

    proposals.set(
      element.id,
      graph.intervalsOf(element.id).map((interval) => ({
        interval,
        recommendation: recommendTreatment(element, interval.neighbour, rules),
      })),
    );
  }

  const winner = decideSeams(proposals, byId, claimed);

  for (const [hostId, entries] of proposals) {
    const element = byId.get(hostId);
    const chains = graph.chainsOf(hostId);
    if (!element) continue;

    for (const { interval, recommendation } of entries) {
      if (!treatmentIsDrawn(recommendation.treatment)) continue;

      if (interval.neighbour.kind === 'element') {
        const key = seamKey(hostId, interval.neighbour.id);
        if (claimed.has(key)) continue;
        if (winner.get(key) !== hostId) continue;
      }

      const chain = chains[interval.side];
      if (!chain) continue;
      const points = runPolyline(chain, interval.from, interval.to);
      if (points.length < 2) continue;

      runs.push(
        materialise({
          id: `${hostId}:edge:${interval.side}:${interval.from.toFixed(3)}`,
          hostId,
          runId: null,
          side: interval.side,
          from: interval.from,
          to: interval.to,
          points,
          length: interval.length,
          treatment: recommendation.treatment,
          materialId: recommendation.materialId,
          neighbour: interval.neighbour,
          source: 'auto',
          why: recommendation.why,
        }),
      );
    }
  }

  return { runs, graph };
}

/**
 * What the editor shows a host, whichever mode it is in.
 *
 * Auto mode has no stored runs, so the inspector's list and the canvas both need the resolved
 * answer — and entering Custom materialises exactly this, which is what makes switching modes
 * change nothing on screen.
 */
export function resolvedRunsFor(
  elements: DesignElement[],
  hostId: string,
  context: BoundaryContext = {},
  rules?: EdgeRuleContext,
): ResolvedEdgeRun[] {
  return resolveEdges(elements, context, rules).runs.filter((run) => run.hostId === hostId);
}

/* ---------------------------------------------------------------- the cut edge */

/**
 * Which segments of each surface's tessellated outline carry the painter's spade-cut line.
 *
 * The cut edge is the faint mark that says "this is a bed rather than a patch of the lawn" — a
 * drawing convention rather than a product, drawn where nothing is *built* but two different things
 * still meet. It used to be stroked round the whole of any planting, gravel or water outline, which
 * is what drew a line along every zone seam of a gravel garden.
 *
 * Keyed by element id, one flag per segment of `geometryOutline`. A surface missing from the map
 * draws none; an absent map means "all", which is what the painter did before this existed and what
 * a caller with no scene still gets.
 */
export function cutEdgeMasks(
  elements: DesignElement[],
  context: BoundaryContext = {},
  rules?: EdgeRuleContext,
): Map<string, boolean[]> {
  return cutEdgeMasksFor(elements, resolveEdges(elements, context, rules));
}

/**
 * The same answer from a resolution the caller already has, so a scene that resolves its edging to
 * draw it does not build the boundary graph a second time to decide its cut lines.
 */
export function cutEdgeMasksFor(
  elements: DesignElement[],
  { runs, graph }: EdgeResolution,
): Map<string, boolean[]> {
  const built = new Map<string, ResolvedEdgeRun[]>();
  for (const run of runs) {
    if (!built.has(run.hostId)) built.set(run.hostId, []);
    built.get(run.hostId)!.push(run);
  }

  const masks = new Map<string, boolean[]>();

  for (const element of elements) {
    if (!isGround(element)) continue;
    const outline = geometryOutline(element.shape);
    if (outline.length < 3) continue;

    /*
     * A base fill *is* the ground — one polygon per zone, whose inner edges are the house's wall
     * planes extended to the fence. None of that is a cut in the ground, and stroking it is what
     * put a dark line across the middle of a garden.
     */
    if (element.role === 'fill' && element.fillKind === 'base') {
      masks.set(element.id, outline.map(() => false));
      continue;
    }

    const chains = graph.chainsOf(element.id);
    const intervals = graph.intervalsOf(element.id);
    const hostMaterial = element.material ?? defaultMaterial(element.category);

    masks.set(
      element.id,
      outline.map((point, index) => {
        const next = outline[(index + 1) % outline.length]!;
        const mid = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
        const hit = nearestSide(chains, mid);
        if (!hit) return false;

        const interval = intervals.find(
          (candidate) =>
            candidate.side === hit.side && hit.distance >= candidate.from && hit.distance <= candidate.to,
        );
        if (!interval) return false;

        // Nothing is cut under something built: a 100 mm course covers a 30 mm line.
        const covered = (built.get(element.id) ?? []).some(
          (run) => run.side === hit.side && hit.distance >= run.from && hit.distance <= run.to,
        );
        if (covered) return false;

        const { neighbour } = interval;
        if (neighbour.kind === 'house' || neighbour.kind === 'boundary') return false;
        if (neighbour.kind === 'element') {
          if ((neighbour.material ?? defaultMaterial(neighbour.category)) === hostMaterial) return false;
          // A pool set in a patio keeps its lip; everything else lets the paving be the edge.
          if (neighbour.category === 'paved-area' && element.category !== 'water-feature') return false;
        }

        return true;
      }),
    );
  }

  return masks;
}

/**
 * A mask over a ring's segments, joined into the continuous chains a stroke should follow.
 *
 * The painter strokes its cut edge along these, so a line that stops at a seam stops exactly where
 * the mask says and a line round a curve is one mitred polyline rather than two dozen stubs with a
 * notch at every vertex. A ring whose first and last segments are both kept is one chain through
 * the start point, not two meeting there; an unbroken ring is a single closed chain.
 */
export function segmentChains(ring: Point[], kept: boolean[]): Point[][] {
  const count = ring.length;
  if (count === 0 || kept.every((keep) => !keep)) return [];
  if (kept.every((keep) => keep)) return [[...ring, ring[0]!]];

  const start = kept.findIndex((keep, index) => keep && !kept[(index - 1 + count) % count]);
  const chains: Point[][] = [];
  let current: Point[] = [];

  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (kept[index]) {
      if (current.length === 0) current.push(ring[index]!);
      current.push(ring[(index + 1) % count]!);
      continue;
    }
    if (current.length >= 2) chains.push(current);
    current = [];
  }
  if (current.length >= 2) chains.push(current);

  return chains;
}

/* ---------------------------------------------------------------- internals */

function seamKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function neighbourAt(
  graph: BoundaryGraph,
  hostId: string,
  side: number,
  distance: number,
): Neighbour | null {
  const interval = graph
    .intervalsOf(hostId)
    .find((candidate) => candidate.side === side && distance >= candidate.from && distance <= candidate.to);
  return interval?.neighbour ?? null;
}

function decideSeams(
  proposals: Map<string, { interval: BoundaryInterval; recommendation: { treatment: EdgeTreatment } }[]>,
  byId: Map<string, DesignElement>,
  claimed: Set<string>,
): Map<string, string> {
  const wants = new Map<string, Set<string>>();

  for (const [hostId, entries] of proposals) {
    for (const { interval, recommendation } of entries) {
      if (interval.neighbour.kind !== 'element') continue;
      if (!treatmentIsDrawn(recommendation.treatment)) continue;

      const key = seamKey(hostId, interval.neighbour.id);
      if (claimed.has(key)) continue;
      if (!wants.has(key)) wants.set(key, new Set());
      wants.get(key)!.add(hostId);
    }
  }

  const winner = new Map<string, string>();

  for (const [key, hosts] of wants) {
    const candidates = [...hosts];
    if (candidates.length === 1) {
      winner.set(key, candidates[0]!);
      continue;
    }

    const [a, b] = candidates;
    const first = byId.get(a!);
    const second = byId.get(b!);
    if (!first || !second) {
      winner.set(key, candidates[0]!);
      continue;
    }

    winner.set(
      key,
      seamOwner(
        { id: first.id, category: first.category },
        { id: second.id, category: second.category },
      ),
    );
  }

  return winner;
}

function materialise(run: {
  id: string;
  hostId: string;
  runId: string | null;
  side: number;
  from: number;
  to: number;
  points: Point[];
  length: number;
  treatment: EdgeTreatment;
  materialId: string | null;
  widthMm?: number;
  heightMm?: number;
  neighbour: Neighbour | null;
  source: EdgeSource;
  why?: string;
}): ResolvedEdgeRun {
  const spec = treatmentSpec(run.treatment);
  const materialId = run.materialId ?? spec.defaultMaterial;

  const widthM =
    run.widthMm !== undefined
      ? run.widthMm / 1000
      : run.treatment === 'flush'
        ? FLUSH_WIDTH_MM / 1000
        : edgingWidthMetres(materialId ?? undefined);

  const heightM = !spec.raised
    ? 0
    : run.heightMm !== undefined
      ? run.heightMm / 1000
      : edgingHeight(materialId ?? undefined);

  return {
    id: run.id,
    hostId: run.hostId,
    runId: run.runId,
    side: run.side,
    from: run.from,
    to: run.to,
    points: run.points,
    length: run.length,
    treatment: run.treatment,
    materialId,
    widthM,
    heightM,
    neighbour: run.neighbour,
    source: run.source,
    ...(run.why === undefined ? {} : { why: run.why }),
  };
}

/* ---------------------------------------------------------------- quantities */

/** Total linear metres of one product across the plan, which is what the schedule prints. */
export function edgeLengthOf(runs: ResolvedEdgeRun[], materialId: string): number {
  return runs.reduce((total, run) => (run.materialId === materialId ? total + run.length : total), 0);
}

/** Every product in use, so the schedule can group without scanning twice. */
export function edgeMaterialsUsed(runs: ResolvedEdgeRun[]): string[] {
  return [...new Set(runs.flatMap((run) => (run.materialId ? [run.materialId] : [])))];
}
