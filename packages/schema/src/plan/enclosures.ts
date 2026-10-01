import { edgeLength, type Point } from '../geometry/primitives.js';
import { boundaryRuns, type BoundaryRun, type SiteForBoundaries } from './boundary-styles.js';
import type { BoundaryKind } from './boundary-style.js';
import { WALL_REACH } from './boundary/graph.js';
import type { DesignElement } from './concepts.js';
import { ENCLOSURE_KINDS, type EnclosureKind } from './enclosure.js';
import { heightFor } from './heights.js';

/**
 * Where a proposed enclosure goes, and what of the survey it replaces.
 *
 * The resolver half of `enclosure.ts`. Everything is derived from the element's centreline and the
 * site's own sides on every read, so nothing is kept in step: drag a new fence off the fence line
 * and the survey's side comes back, because the stretch it replaced was never written down.
 */

/** How nearly parallel a proposed line must be to a side to count as lying along it. */
export const ALONG_ANGLE_DEGREES = 5;

/** Below this, a stretch left over or replaced is a rounding error rather than a piece of fence. */
const MIN_PIECE = 0.05;

/** The kind of an enclosure, falling back to the fence it most likely is when nobody said. */
export function enclosureKindOf(element: Pick<DesignElement, 'enclosure'>): EnclosureKind {
  return element.enclosure?.kind ?? 'fence';
}

/** Whether a kind draws as a boundary run. A kerb is a course on the ground, drawn as edging. */
function asBoundaryKind(kind: EnclosureKind): BoundaryKind | null {
  return kind === 'kerb' ? null : kind;
}

export interface EffectiveBoundary {
  /** What the survey still has: every side, minus the stretches a proposal replaces. */
  survey: BoundaryRun[];
  /** The survey's stretches a proposal replaces — drawn faintly in the editor, counted as removed. */
  replaced: BoundaryRun[];
  /** The proposed enclosures, one run per straight piece. Kerbs are not here; see `kerbLines`. */
  proposed: BoundaryRun[];
}

interface Along {
  run: BoundaryRun;
  /** Metres along the run from its start. */
  from: number;
  to: number;
}

/**
 * The part of a survey side a segment lies along, if it does: nearly parallel, and both ends
 * within `WALL_REACH` of the side's line — the reach the boundary graph uses for "against the
 * fence", so a screen held a hand's width off the fence still replaces it.
 */
function alongSide(start: Point, end: Point, run: BoundaryRun): Along | null {
  const dx = run.end.x - run.start.x;
  const dy = run.end.y - run.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;

  const sx = end.x - start.x;
  const sy = end.y - start.y;
  const segment = Math.hypot(sx, sy);
  if (segment === 0) return null;
  const sine = Math.abs((sx * uy - sy * ux) / segment);
  if (sine > Math.sin((ALONG_ANGLE_DEGREES * Math.PI) / 180)) return null;

  const offset = (point: Point) => Math.abs((point.x - run.start.x) * -uy + (point.y - run.start.y) * ux);
  if (offset(start) > WALL_REACH || offset(end) > WALL_REACH) return null;

  const at = (point: Point) => (point.x - run.start.x) * ux + (point.y - run.start.y) * uy;
  const from = Math.max(0, Math.min(at(start), at(end)));
  const to = Math.min(length, Math.max(at(start), at(end)));
  return to - from >= MIN_PIECE ? { run, from, to } : null;
}

function pointAlong(run: BoundaryRun, metres: number): Point {
  const t = run.length === 0 ? 0 : metres / run.length;
  return { x: run.start.x + (run.end.x - run.start.x) * t, y: run.start.y + (run.end.y - run.start.y) * t };
}

function piece(run: BoundaryRun, from: number, to: number, suffix: string): BoundaryRun {
  const start = pointAlong(run, from);
  const end = pointAlong(run, to);
  return { ...run, id: `${run.id ?? run.edgeVertexId}${suffix}`, start, end, length: edgeLength(start, end) };
}

/** Sorted, merged intervals. */
function merge(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged.at(-1);
    if (last && from <= last[1] + MIN_PIECE) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

function leftNormal(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 0, y: 0 } : { x: -dy / length, y: dx / length };
}

/** True when the ring runs clockwise in this y-down frame — the renderer's own test. */
function clockwise(points: Point[]): boolean {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice > 0;
}

function segmentsOf(element: DesignElement): [Point, Point][] {
  if (element.category !== 'enclosure' || element.shape.kind !== 'polyline') return [];
  const points = element.shape.points;
  const segments: [Point, Point][] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (edgeLength(points[index]!, points[index + 1]!) >= MIN_PIECE) segments.push([points[index]!, points[index + 1]!]);
  }
  return segments;
}

/**
 * The property's sides as the design leaves them, and the enclosures it proposes.
 *
 * With no enclosures this is exactly `boundaryRuns(site)` in `survey`, and a test says so: every
 * consumer switched to it draws, shades and counts an existing plan as it did.
 *
 * A proposed piece that lies along a side is drawn as the survey's own band is — from the line
 * inward, its ends projected onto the line — so the new fence stands where the old one did. One in
 * the garden is centred on its line, which is where a freestanding wall is built.
 */
export function effectiveBoundaryRuns(
  site: SiteForBoundaries,
  elements: DesignElement[],
): EffectiveBoundary {
  const runs = boundaryRuns(site).map((run) => ({ ...run, id: run.edgeVertexId }));
  const enclosures = elements.filter((element) => element.category === 'enclosure' && !element.hidden);
  if (enclosures.length === 0) return { survey: runs, replaced: [], proposed: [] };

  const ring = site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const wound = clockwise(ring);
  const inwardOf = (run: BoundaryRun): Point => {
    const left = leftNormal(run.start, run.end);
    return wound ? left : { x: -left.x, y: -left.y };
  };

  const covered = new Map<string, [number, number][]>();
  const proposed: BoundaryRun[] = [];

  for (const element of enclosures) {
    const kind = asBoundaryKind(enclosureKindOf(element));
    const thickness = element.shape.kind === 'polyline' ? element.shape.width : ENCLOSURE_KINDS.fence.thickness;
    const height = heightFor(element);

    segmentsOf(element).forEach(([start, end], index) => {
      const along = runs.map((run) => alongSide(start, end, run)).find((match) => match !== null) ?? null;
      if (along) {
        const intervals = covered.get(along.run.id!) ?? [];
        intervals.push([along.from, along.to]);
        covered.set(along.run.id!, intervals);
      }
      if (!kind) return;

      const base = along ? piece(along.run, along.from, along.to, '') : null;
      const inward = along ? inwardOf(along.run) : leftNormal(start, end);
      /* Centred on a freestanding line: the band is drawn from `start` inward, so start half back. */
      const shift = along ? 0 : thickness / 2;
      const from = base ? base.start : { x: start.x - inward.x * shift, y: start.y - inward.y * shift };
      const to = base ? base.end : { x: end.x - inward.x * shift, y: end.y - inward.y * shift };
      proposed.push({
        id: `${element.id}:${index}`,
        edgeVertexId: along?.run.edgeVertexId ?? element.id,
        sourceId: element.id,
        start: from,
        end: to,
        kind,
        height,
        thickness,
        length: edgeLength(from, to),
        inward,
      });
    });
  }

  const survey: BoundaryRun[] = [];
  const replaced: BoundaryRun[] = [];
  for (const run of runs) {
    const intervals = covered.get(run.id!);
    if (!intervals) {
      survey.push(run);
      continue;
    }
    let cursor = 0;
    merge(intervals).forEach(([from, to], index) => {
      if (from - cursor >= MIN_PIECE) survey.push(piece(run, cursor, from, `#${index}`));
      replaced.push(piece(run, from, to, `~${index}`));
      cursor = to;
    });
    if (run.length - cursor >= MIN_PIECE) survey.push(piece(run, cursor, run.length, '#end'));
  }

  return { survey, replaced, proposed };
}

/** The kerbs, as centrelines to lay an edging course along. */
export function kerbLines(elements: DesignElement[]): { id: string; points: Point[]; width: number }[] {
  return elements.flatMap((element) =>
    element.category === 'enclosure' &&
    !element.hidden &&
    enclosureKindOf(element) === 'kerb' &&
    element.shape.kind === 'polyline'
      ? [{ id: element.id, points: element.shape.points, width: element.shape.width }]
      : [],
  );
}
