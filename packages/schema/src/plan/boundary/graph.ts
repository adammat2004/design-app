import { pointInPolygon, type Point } from '../../geometry/primitives.js';
import { sampleChain } from '../../geometry/stations.js';
import { geometryOutline } from '../features.js';
import { isPlantSymbol } from '../symbols.js';
import { MIN_EDGE_RUN_LENGTH } from '../edges/treatments.js';
import { sideChains, type SideChain } from './side-chains.js';
import type { DesignElement, ElementCategory } from '../concepts.js';

/**
 * What lies on the other side of every stretch of every surface's boundary.
 *
 * This is a **spatial primitive, not an edging feature**. The question "where does this patio meet
 * the lawn, and where does it meet the path" is the same question a kerb, a retaining wall, a
 * flight of steps, a drainage channel, a fence and a planting interface all ask, and until now
 * nothing in the model could answer it: `edgingRuns` probed its neighbours privately and threw the
 * answer away, and the design layer's only notion of adjacency was a bounding-box overlap inside
 * one branch of the assistant's planner.
 *
 * Pure and query-free, so the renderer, the editor, the generator and the planner all share one
 * answer. Nothing here decides what to *build* — `edges/rules.ts` does that, reading this.
 *
 * ## How a stretch is classified
 *
 * Each side chain is cut into cells of about `GRAPH_SAMPLE` and each cell is classified by its own
 * midpoint: facing the fence or the house within `WALL_REACH`, or — by probing `FAR_SIDE_PROBE`
 * outside the boundary — the topmost surface covering the ground just beyond it, else bare ground. Adjacent cells with
 * the same neighbour merge, and slivers are absorbed.
 *
 * **Cells rather than vertices** is what makes the intervals stable. Classifying at vertices would
 * move every interval's ends when a curve was re-tessellated; a uniform partition of the side puts
 * them on the same stations every build, which is what a cache key and a stored run both need.
 *
 * **Topmost wins, and topmost means last in the array**, which is stacking order — the same
 * reading `measureComposition` takes and the renderer draws by. A bed drawn over a lawn is what
 * the patio beside it meets, not the lawn underneath.
 */

/** About a hand's width. Fine enough to find a path crossing a patio's edge, coarse enough to be cheap. */
export const GRAPH_SAMPLE = 0.1;

/**
 * How far outside a boundary the far side is read, in metres.
 *
 * Far enough to clear the floating-point slop in a zone polygon clipped against the boundary, and
 * well under any gap a designer would draw between two surfaces.
 */
export const FAR_SIDE_PROBE = 0.08;

/**
 * How close a stretch has to come to the fence or the house to count as meeting it, in metres.
 *
 * Along the stretch's own outward normal, and measured rather than chosen: the generator holds every
 * border 150 mm off the fence, and a strip that narrow is a maintenance gap, not a join anybody
 * builds an edge along. Read at a floating-point tolerance, that gap showed through as the base lawn
 * and every border in a formal garden grew a brick course facing its own fence. 350 mm is still well
 * under a mowing strip, so a bed deliberately held off the fence by one is edged on that side.
 */
export const WALL_REACH = 0.35;

/** The categories whose outline is a surface on the ground, and can therefore meet another. */
const GROUND_CATEGORIES = new Set<ElementCategory>([
  'lawn',
  'planting-bed',
  'paved-area',
  'gravel-mulch',
  'water-feature',
]);

export type Neighbour =
  | { kind: 'element'; id: string; category: ElementCategory; material: string | undefined }
  | { kind: 'house' }
  | { kind: 'boundary' }
  | { kind: 'ground' };

export interface BoundaryInterval {
  hostId: string;
  side: number;
  /** Metres along the side chain, from its start. */
  from: number;
  to: number;
  length: number;
  neighbour: Neighbour;
}

export interface BoundaryContext {
  boundary?: Point[];
  house?: Point[];
}

export interface BoundaryGraph {
  /** Every stretch of one host's boundary, in side then distance order. */
  intervalsOf(hostId: string): BoundaryInterval[];
  /** The host's side chains, so a caller can resolve a run without re-tessellating. */
  chainsOf(hostId: string): SideChain[];
  /** Where two surfaces meet, read from the first one's boundary. */
  between(hostId: string, otherId: string): BoundaryInterval[];
  /** Every stretch of a host's boundary whose neighbour answers the predicate. */
  facing(hostId: string, predicate: (neighbour: Neighbour) => boolean): BoundaryInterval[];
  /** Every host the graph knows about, in element order. */
  hosts(): string[];
}

interface Cover {
  id: string;
  category: ElementCategory;
  material: string | undefined;
  outline: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function buildBoundaryGraph(
  elements: DesignElement[],
  context: BoundaryContext = {},
): BoundaryGraph {
  const walls: { ring: Point[]; neighbour: Neighbour }[] = [];
  if (context.house && context.house.length >= 3) {
    walls.push({ ring: context.house, neighbour: { kind: 'house' } });
  }
  if (context.boundary && context.boundary.length >= 3) {
    walls.push({ ring: context.boundary, neighbour: { kind: 'boundary' } });
  }

  const covers = elements.filter(isGround).map(toCover);
  const chains = new Map<string, SideChain[]>();
  const intervals = new Map<string, BoundaryInterval[]>();

  for (const element of elements) {
    if (!isGround(element)) continue;

    const hostChains = sideChains(element.shape);
    if (hostChains.length === 0) continue;

    const outline = geometryOutline(element.shape);
    chains.set(element.id, hostChains);
    intervals.set(
      element.id,
      hostChains.flatMap((chain) => classifySide(element.id, chain, outline, covers, walls)),
    );
  }

  return {
    intervalsOf: (hostId) => intervals.get(hostId) ?? [],
    chainsOf: (hostId) => chains.get(hostId) ?? [],
    between: (hostId, otherId) =>
      (intervals.get(hostId) ?? []).filter(
        (interval) => interval.neighbour.kind === 'element' && interval.neighbour.id === otherId,
      ),
    facing: (hostId, predicate) =>
      (intervals.get(hostId) ?? []).filter((interval) => predicate(interval.neighbour)),
    hosts: () => [...intervals.keys()],
  };
}

/** Whether a surface is one the graph reasons about at all. */
export function isGround(element: DesignElement): boolean {
  if (element.hidden) return false;
  if (!GROUND_CATEGORIES.has(element.category)) return false;
  // A tree is a `planting-bed` point, and its canopy is not a surface anything meets on the ground.
  if (isPlantSymbol(element.symbol)) return false;
  return element.shape.kind !== 'point' || !isPlantSymbol(element.symbol);
}

export function sameNeighbour(a: Neighbour, b: Neighbour): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'element' && b.kind === 'element' ? a.id === b.id : true;
}

/** A short phrase for a neighbour, for an explanation or a chip. Never a position. */
export function describeNeighbour(neighbour: Neighbour, nameOf?: (id: string) => string): string {
  switch (neighbour.kind) {
    case 'house':
      return 'the house';
    case 'boundary':
      return 'the boundary';
    case 'ground':
      return 'open ground';
    case 'element':
      return nameOf?.(neighbour.id) ?? neighbour.category.replace('-', ' ');
  }
}

/* ---------------------------------------------------------------- internals */

function toCover(element: DesignElement): Cover {
  const outline = geometryOutline(element.shape);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of outline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    id: element.id,
    category: element.category,
    material: element.material,
    outline,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function classifySide(
  hostId: string,
  chain: SideChain,
  hostOutline: Point[],
  covers: Cover[],
  walls: { ring: Point[]; neighbour: Neighbour }[],
): BoundaryInterval[] {
  if (chain.length <= 0) return [];

  const cells = Math.max(1, Math.ceil(chain.length / GRAPH_SAMPLE));
  const step = chain.length / cells;
  const found: BoundaryInterval[] = [];

  for (let cell = 0; cell < cells; cell += 1) {
    const at = sampleChain(chain.measure, (cell + 0.5) * step);
    const neighbour = classifyPoint(hostId, at, hostOutline, covers, walls);
    const previous = found.at(-1);

    if (previous && sameNeighbour(previous.neighbour, neighbour)) {
      previous.to = (cell + 1) * step;
      previous.length = previous.to - previous.from;
      continue;
    }

    found.push({
      hostId,
      side: chain.side,
      from: cell * step,
      to: (cell + 1) * step,
      length: step,
      neighbour,
    });
  }

  return absorbSlivers(found);
}

function classifyPoint(
  hostId: string,
  at: { at: Point; tangent: Point },
  hostOutline: Point[],
  covers: Cover[],
  walls: { ring: Point[]; neighbour: Neighbour }[],
): Neighbour {
  const outward = outwardNormal(at, hostOutline);
  if (!outward) return { kind: 'ground' };

  /*
   * A wall the stretch *faces* wins before anything beyond it is read — measured along the side's
   * own outward normal, never as a plain distance. A bed held 150 mm off the fence faces it across a
   * gap nobody edges, and the point `WALL_REACH` out along its normal lands beyond the fence; but the
   * front of that same bed runs end-on into the fence, and its normal points along it, so the point
   * stays in the garden and the course runs right up to the boundary as a real one would. A plain
   * distance test cut the last 350 mm off every such course.
   */
  const reach = { x: at.at.x + outward.x * WALL_REACH, y: at.at.y + outward.y * WALL_REACH };
  for (const wall of walls) {
    if (wall.neighbour.kind === 'boundary' && !pointInPolygon(reach, wall.ring)) return wall.neighbour;
    if (wall.neighbour.kind === 'house' && pointInPolygon(reach, wall.ring)) return wall.neighbour;
  }

  const probe = { x: at.at.x + outward.x * FAR_SIDE_PROBE, y: at.at.y + outward.y * FAR_SIDE_PROBE };
  const cover = topmostAt(probe, covers, hostId);
  return cover
    ? { kind: 'element', id: cover.id, category: cover.category, material: cover.material }
    : { kind: 'ground' };
}

/**
 * The unit normal pointing away from the host at a point on its boundary.
 *
 * Both normals are tried and the one whose short probe is not inside the host's own outline wins,
 * which is what makes this indifferent to winding — a rectangle's ring runs one way and a
 * hand-drawn or PostGIS-cut polygon may run the other. `null` when neither leaves the host, which a
 * degenerate sliver can manage.
 */
function outwardNormal(at: { at: Point; tangent: Point }, host: Point[]): Point | null {
  const normal = { x: -at.tangent.y, y: at.tangent.x };
  for (const sign of [1, -1]) {
    const probe = {
      x: at.at.x + sign * normal.x * FAR_SIDE_PROBE,
      y: at.at.y + sign * normal.y * FAR_SIDE_PROBE,
    };
    if (!pointInPolygon(probe, host)) return { x: sign * normal.x, y: sign * normal.y };
  }
  return null;
}

function topmostAt(point: Point, covers: Cover[], hostId: string): Cover | null {
  let found: Cover | null = null;

  for (const cover of covers) {
    if (cover.id === hostId) continue;
    if (point.x < cover.minX || point.x > cover.maxX) continue;
    if (point.y < cover.minY || point.y > cover.maxY) continue;
    if (pointInPolygon(point, cover.outline)) found = cover;
  }

  return found;
}

/**
 * Slivers are folded into the neighbour they abut.
 *
 * A single cell of a different material where two surfaces cross at a shallow angle is a fact about
 * the sampling rather than about the garden, and left alone it would offer the user a 100 mm run of
 * brick to edit. The longer of the two neighbours takes it, so the answer does not depend on which
 * way the loop happens to run.
 */
function absorbSlivers(intervals: BoundaryInterval[]): BoundaryInterval[] {
  if (intervals.length <= 1) return intervals;

  let merged = intervals;
  let changed = true;

  while (changed && merged.length > 1) {
    changed = false;
    const shortest = merged.reduce((a, b) => (b.length < a.length ? b : a));
    if (shortest.length >= MIN_EDGE_RUN_LENGTH) break;

    const index = merged.indexOf(shortest);
    const before = merged[index - 1];
    const after = merged[index + 1];
    const into = !before ? after : !after ? before : before.length >= after.length ? before : after;
    if (!into) break;

    into.from = Math.min(into.from, shortest.from);
    into.to = Math.max(into.to, shortest.to);
    into.length = into.to - into.from;
    merged = merged.filter((interval) => interval !== shortest);
    changed = true;
  }

  return merged;
}
