import { edgeLength, type Point } from '../geometry/primitives.js';
import {
  boundaryHeight,
  BOUNDARY_THICKNESS,
  DEFAULT_BOUNDARY_KIND,
  type BoundaryEdgeStyle,
  type BoundaryKind,
} from './boundary-style.js';
import type { SiteSection } from './site.js';

/**
 * Which boundary is which, resolved from the edge ids.
 *
 * The third of the three resolver modules — after `openings.ts` and `gates.ts` — and it keeps both
 * of their rules. Everything resolves through the site's own vertices, so a dragged corner moves
 * its wall with it and nothing has to be kept in sync; and a style whose vertex no longer exists
 * is *dropped* rather than guessed onto some other edge.
 *
 * The one place it differs: a boundary run is **total**. Every edge of a closed plot is enclosed by
 * something, so an edge with no stored style resolves to a fence rather than to `null`. That is not
 * a guess of the kind the other two modules refuse to make — a fence is the documented default, it
 * is what every plot drew before this existed, and the alternative is a garden with a gap in its
 * edge for a reason the user cannot see anywhere on screen.
 */

/** What the resolvers need of the site. Narrow, so a draft, a document or a fixture all fit. */
export type SiteForBoundaries = Pick<SiteSection, 'vertices' | 'boundaryStyles'>;

const MIN_EDGE_LENGTH = 1e-6;

/** One side of the property, ready to draw or to cast a shadow from. */
export interface BoundaryRun {
  /** The vertex this edge starts at — the run's identity, and what a style is keyed on. */
  edgeVertexId: string;
  start: Point;
  end: Point;
  kind: BoundaryKind;
  /** Metres, resolved: the stored height if there is one, else the kind's default. */
  height: number;
  /** Metres on the ground. What the plan draws a band of, and what a hedge really occupies. */
  thickness: number;
  length: number;
}

/** The style stored for one edge, or `null` when nobody has said. */
export function styleForEdge(
  site: SiteForBoundaries,
  edgeVertexId: string,
): BoundaryEdgeStyle | null {
  return site.boundaryStyles.find((style) => style.edgeVertexId === edgeVertexId) ?? null;
}

/** What one edge is made of, falling back to the default rather than to nothing. */
export function kindForEdge(site: SiteForBoundaries, edgeVertexId: string): BoundaryKind {
  return styleForEdge(site, edgeVertexId)?.kind ?? DEFAULT_BOUNDARY_KIND;
}

/**
 * Every side of the property, in vertex order.
 *
 * Returns `[]` for a boundary that is not yet a polygon — a plot still being drawn has edges, but
 * it does not yet have *sides*, and drawing a fence along a half-finished outline would enclose
 * something the user has not described.
 *
 * Degenerate edges are skipped rather than emitted with a zero length: a run of no length has no
 * direction, so every consumer that wanted a normal would have to handle it, and skipping it here
 * means none of them do.
 */
export function boundaryRuns(site: SiteForBoundaries): BoundaryRun[] {
  if (site.vertices.length < 3) return [];

  const runs: BoundaryRun[] = [];

  for (let index = 0; index < site.vertices.length; index += 1) {
    const from = site.vertices[index]!;
    const to = site.vertices[(index + 1) % site.vertices.length]!;

    const start = { x: from.x, y: from.y };
    const end = { x: to.x, y: to.y };
    const length = edgeLength(start, end);
    if (length < MIN_EDGE_LENGTH) continue;

    const stored = styleForEdge(site, from.id);
    const kind = stored?.kind ?? DEFAULT_BOUNDARY_KIND;

    runs.push({
      edgeVertexId: from.id,
      start,
      end,
      kind,
      height: stored ? boundaryHeight(stored) : boundaryHeight({ edgeVertexId: from.id, kind }),
      thickness: BOUNDARY_THICKNESS[kind],
      length,
    });
  }

  return runs;
}

/**
 * Sets one edge's style, replacing whatever was there.
 *
 * Pure, and returns a fresh array — the stores hold their drafts immutably and an in-place edit
 * would not be seen by Zustand's identity comparison.
 *
 * Setting an edge back to the default **removes** the entry rather than storing `'fence'`. A
 * document that records every side as a fence and one that records nothing must round-trip to the
 * same drawing, and the shorter one is the one that says what the user actually stated.
 */
export function setBoundaryStyle(
  styles: BoundaryEdgeStyle[],
  edgeVertexId: string,
  kind: BoundaryKind,
  height?: number,
): BoundaryEdgeStyle[] {
  const rest = styles.filter((style) => style.edgeVertexId !== edgeVertexId);

  if (kind === DEFAULT_BOUNDARY_KIND && height === undefined) return rest;

  return [...rest, { edgeVertexId, kind, ...(height === undefined ? {} : { height }) }];
}

/**
 * Drops styles whose edge has gone.
 *
 * Called after a vertex is deleted. Without it a style would sit in the document for an edge that
 * no longer exists, and — because ids are handed out from a counter — could later be claimed by a
 * corner added in a completely different part of the plot.
 */
export function pruneBoundaryStyles(
  styles: BoundaryEdgeStyle[],
  vertices: { id: string }[],
): BoundaryEdgeStyle[] {
  const live = new Set(vertices.map((vertex) => vertex.id));
  return styles.filter((style) => live.has(style.edgeVertexId));
}
