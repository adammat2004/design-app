import type { LocalPoint, LocalRect } from '../../layout/sketch.js';

/**
 * Rectangles, cut into cells, and the outlines of whatever the cells add up to.
 *
 * The composition speaks in rectangles in the design frame: a terrace, a lawn panel, a bay in a
 * corner, a corridor down the fence. What it needs from them is *shapes*: the lawn with a corner
 * notched round a store, the planting that is left once the lawn, the bays and the corridors have
 * taken their ground. Every one of those is a union or a difference of axis-aligned rectangles, and
 * the exact way to compute one is a grid on every edge any rectangle has: each cell is wholly in or
 * wholly out of every rectangle, so classifying its centre classifies the cell.
 *
 * Pure and exact. No tolerance, no simplify, no PostGIS — a notch is where the bay says it is to
 * the last bit, which is what lets a test assert that no bay stands in the lawn.
 */

export interface CellGrid {
  /** Cell boundaries along `u`, ascending. Cell `i` spans `us[i]..us[i + 1]`. */
  us: number[];
  vs: number[];
}

/** A grid on every edge of every rectangle, clipped to `bounds`. */
export function gridOver(bounds: LocalRect, rects: LocalRect[]): CellGrid {
  const clampU = (u: number) => Math.min(bounds.u1, Math.max(bounds.u0, u));
  const clampV = (v: number) => Math.min(bounds.v1, Math.max(bounds.v0, v));
  const us = unique([bounds.u0, bounds.u1, ...rects.flatMap((r) => [clampU(r.u0), clampU(r.u1)])]);
  const vs = unique([bounds.v0, bounds.v1, ...rects.flatMap((r) => [clampV(r.v0), clampV(r.v1)])]);
  return { us, vs };
}

/** The centre of cell (i, j). */
export function cellCentre(grid: CellGrid, i: number, j: number): LocalPoint {
  return { u: (grid.us[i]! + grid.us[i + 1]!) / 2, v: (grid.vs[j]! + grid.vs[j + 1]!) / 2 };
}

export function inRect(point: LocalPoint, rect: LocalRect): boolean {
  return point.u > rect.u0 && point.u < rect.u1 && point.v > rect.v0 && point.v < rect.v1;
}

/**
 * The outlines of every cell the predicate accepts, as closed loops.
 *
 * Each loop runs with the accepted cells on its left, so an outer boundary comes back
 * anticlockwise in (u, v) and a hole clockwise — `outer` says which. Collinear vertices are
 * dropped. Where two cells touch only at a corner the loop turns left, which keeps two lobes that
 * meet at a point as two loops rather than one self-touching figure.
 */
export function loopsOf(
  grid: CellGrid,
  accept: (i: number, j: number) => boolean,
): { points: LocalPoint[]; outer: boolean }[] {
  const cols = grid.us.length - 1;
  const rows = grid.vs.length - 1;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && accept(i, j);

  /* Directed edges between integer grid vertices, keyed by their start. */
  const outgoing = new Map<string, [number, number][]>();
  const add = (from: [number, number], to: [number, number]) => {
    const key = `${from[0]},${from[1]}`;
    outgoing.set(key, [...(outgoing.get(key) ?? []), to]);
  };

  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      if (!inside(i, j)) continue;
      /* (u, v) as (x, y): anticlockwise round the cell, interior on the left. */
      if (!inside(i, j - 1)) add([i, j], [i + 1, j]);
      if (!inside(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!inside(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!inside(i - 1, j)) add([i, j + 1], [i, j]);
    }
  }

  const loops: { points: LocalPoint[]; outer: boolean }[] = [];
  const keys = [...outgoing.keys()].sort();

  for (const startKey of keys) {
    while ((outgoing.get(startKey)?.length ?? 0) > 0) {
      const start = startKey.split(',').map(Number) as [number, number];
      const vertices: [number, number][] = [start];
      let previous: [number, number] | null = null;
      let current = start;

      for (let guard = 0; guard < 100_000; guard += 1) {
        const key = `${current[0]},${current[1]}`;
        const options = outgoing.get(key) ?? [];
        if (options.length === 0) break;

        const index = previous ? leftmost(previous, current, options) : 0;
        const next = options[index]!;
        options.splice(index, 1);

        previous = current;
        current = next;
        if (current[0] === start[0] && current[1] === start[1]) break;
        vertices.push(current);
      }

      const points = simplifyCollinear(
        vertices.map(([i, j]) => ({ u: grid.us[i]!, v: grid.vs[j]! })),
      );
      if (points.length >= 3) loops.push({ points, outer: signedArea(points) > 0 });
    }
  }

  return loops;
}

/**
 * The outline of `base` with `cuts` taken out, or `null` when that is not one simple shape.
 *
 * `null` is the refusal a composition relies on: a cut wholly inside the panel would leave a hole,
 * which `PlanGeometry.polygon` cannot hold and which would read as a feature marooned in the lawn —
 * the fault this layer exists to prevent. A cut that splits the panel in two is refused for the same
 * reason: one open space is the point.
 */
export function outlineWithout(base: LocalRect, cuts: LocalRect[]): LocalPoint[] | null {
  const grid = gridOver(base, cuts);
  const loops = loopsOf(grid, (i, j) => {
    const centre = cellCentre(grid, i, j);
    return inRect(centre, base) && !cuts.some((cut) => inRect(centre, cut));
  });
  if (loops.length !== 1 || !loops[0]!.outer) return null;
  return loops[0]!.points;
}

/** Signed area in (u, v): positive anticlockwise. */
export function signedArea(points: LocalPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.u * b.v - b.u * a.v;
  }
  return area / 2;
}

export function rectArea(rect: LocalRect): number {
  return Math.max(0, rect.u1 - rect.u0) * Math.max(0, rect.v1 - rect.v0);
}

/** Whether two rectangles share interior, with an optional gap either must keep from the other. */
export function rectsOverlap(a: LocalRect, b: LocalRect, gap = 0): boolean {
  return (
    a.u0 < b.u1 + gap && b.u0 < a.u1 + gap && a.v0 < b.v1 + gap && b.v0 < a.v1 + gap
  );
}

export function intersectRects(a: LocalRect, b: LocalRect): LocalRect | null {
  const rect = {
    u0: Math.max(a.u0, b.u0),
    u1: Math.min(a.u1, b.u1),
    v0: Math.max(a.v0, b.v0),
    v1: Math.min(a.v1, b.v1),
  };
  return rect.u1 > rect.u0 + 1e-9 && rect.v1 > rect.v0 + 1e-9 ? rect : null;
}

export function grow(rect: LocalRect, by: number): LocalRect {
  return { u0: rect.u0 - by, u1: rect.u1 + by, v0: rect.v0 - by, v1: rect.v1 + by };
}

/** Of the edges leaving `current`, the one that turns furthest left from the way we arrived. */
function leftmost(
  previous: [number, number],
  current: [number, number],
  options: [number, number][],
): number {
  const inU = current[0] - previous[0];
  const inV = current[1] - previous[1];
  let best = 0;
  let bestTurn = -Infinity;
  options.forEach((next, index) => {
    const outU = next[0] - current[0];
    const outV = next[1] - current[1];
    const turn = Math.atan2(inU * outV - inV * outU, inU * outU + inV * outV);
    if (turn > bestTurn) {
      bestTurn = turn;
      best = index;
    }
  });
  return best;
}

function simplifyCollinear(points: LocalPoint[]): LocalPoint[] {
  return points.filter((point, i) => {
    const before = points[(i + points.length - 1) % points.length]!;
    const after = points[(i + 1) % points.length]!;
    const cross = (point.u - before.u) * (after.v - point.v) - (point.v - before.v) * (after.u - point.u);
    return Math.abs(cross) > 1e-12;
  });
}

function unique(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, i) => i === 0 || value - sorted[i - 1]! > 1e-9);
}
