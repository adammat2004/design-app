import { describe, expect, it } from 'vitest';
import { BOUNDARY_HEIGHTS, DEFAULT_BOUNDARY_KIND } from './boundary-style.js';
import {
  boundaryRuns,
  kindForEdge,
  pruneBoundaryStyles,
  setBoundaryStyle,
  type SiteForBoundaries,
} from './boundary-styles.js';

/** A 10 x 6 m plot, drawn clockwise. */
const site = (boundaryStyles: SiteForBoundaries['boundaryStyles'] = []): SiteForBoundaries => ({
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 10, y: 0 },
    { id: 'v2', x: 10, y: 6 },
    { id: 'v3', x: 0, y: 6 },
  ],
  boundaryStyles,
});

describe('boundaryRuns', () => {
  /**
   * The one place these resolvers deliberately differ from `openings.ts` and `gates.ts`, which
   * return `null` rather than guess. Every side of a closed plot *is* enclosed by something, so an
   * undescribed side is a fence — the documented default and what every plot drew before the kinds
   * existed. A gap in the garden's edge for a reason the user cannot see would be far worse.
   */
  it('gives every side a kind, defaulting to a fence', () => {
    const runs = boundaryRuns(site());

    expect(runs).toHaveLength(4);
    expect(runs.every((run) => run.kind === DEFAULT_BOUNDARY_KIND)).toBe(true);
  });

  it('reads a stored style and leaves the other sides alone', () => {
    const runs = boundaryRuns(site([{ edgeVertexId: 'v1', kind: 'wall' }]));

    expect(runs.map((run) => run.kind)).toEqual(['fence', 'wall', 'fence', 'fence']);
  });

  it('resolves the kind’s height when none is stored, and the stored one when there is', () => {
    const [first] = boundaryRuns(site([{ edgeVertexId: 'v0', kind: 'hedge' }]));
    expect(first!.height).toBe(BOUNDARY_HEIGHTS.hedge);

    const [taller] = boundaryRuns(site([{ edgeVertexId: 'v0', kind: 'hedge', height: 3 }]));
    expect(taller!.height).toBe(3);
  });

  it('measures each side, so the panel can name it without a compass', () => {
    expect(boundaryRuns(site()).map((run) => run.length)).toEqual([10, 6, 10, 6]);
  });

  /** A plot still being clicked out has edges but not yet sides. */
  it('returns nothing for an outline that is not a polygon', () => {
    expect(boundaryRuns({ vertices: [{ id: 'v0', x: 0, y: 0 }], boundaryStyles: [] })).toEqual([]);
  });

  /**
   * A run of no length has no direction, so every consumer wanting an inward normal would have to
   * handle it. Skipping here means none of them do.
   */
  it('skips a degenerate edge rather than emitting one with no direction', () => {
    const runs = boundaryRuns({
      vertices: [
        { id: 'v0', x: 0, y: 0 },
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 10, y: 0 },
        { id: 'v3', x: 10, y: 6 },
      ],
      boundaryStyles: [],
    });

    expect(runs.every((run) => run.length > 0)).toBe(true);
  });

  /**
   * The identity a style is keyed on. Dragging a corner moves its wall with it — the same
   * positional identity `Gate.edgeVertexId` and `Opening.wallId` rely on.
   */
  it('keeps a side’s kind when its corner is dragged', () => {
    const styles = [{ edgeVertexId: 'v1' as const, kind: 'wall' as const }];
    const moved: SiteForBoundaries = {
      vertices: [
        { id: 'v0', x: 0, y: 0 },
        { id: 'v1', x: 14, y: -1 },
        { id: 'v2', x: 10, y: 6 },
        { id: 'v3', x: 0, y: 6 },
      ],
      boundaryStyles: styles,
    };

    expect(kindForEdge(moved, 'v1')).toBe('wall');
    expect(boundaryRuns(moved)[1]!.kind).toBe('wall');
  });
});

describe('setBoundaryStyle', () => {
  it('sets a side without touching the others', () => {
    const next = setBoundaryStyle([{ edgeVertexId: 'v0', kind: 'hedge' }], 'v2', 'railing');

    expect(next).toEqual([
      { edgeVertexId: 'v0', kind: 'hedge' },
      { edgeVertexId: 'v2', kind: 'railing' },
    ]);
  });

  it('replaces rather than appending a second entry for one side', () => {
    const next = setBoundaryStyle([{ edgeVertexId: 'v0', kind: 'hedge' }], 'v0', 'wall');

    expect(next).toEqual([{ edgeVertexId: 'v0', kind: 'wall' }]);
  });

  /**
   * A document that records every side as a fence and one that records nothing must round-trip to
   * the same drawing, and the shorter one is the one that says what the user actually stated.
   */
  it('removes the entry when a side goes back to the default', () => {
    expect(setBoundaryStyle([{ edgeVertexId: 'v0', kind: 'wall' }], 'v0', 'fence')).toEqual([]);
  });

  it('keeps an explicit height even on a default kind, because that is a statement', () => {
    expect(setBoundaryStyle([], 'v0', 'fence', 2.4)).toEqual([
      { edgeVertexId: 'v0', kind: 'fence', height: 2.4 },
    ]);
  });

  it('returns a fresh array, so the store’s identity comparison sees the change', () => {
    const before = [{ edgeVertexId: 'v0' as const, kind: 'wall' as const }];
    expect(setBoundaryStyle(before, 'v1', 'hedge')).not.toBe(before);
  });
});

describe('pruneBoundaryStyles', () => {
  /**
   * Vertex ids come from a counter, so a style left behind for a deleted corner could later be
   * claimed by a corner added somewhere else entirely — a wall silently appearing on a side nobody
   * described.
   */
  it('drops a style whose corner has gone', () => {
    const styles = [
      { edgeVertexId: 'v0', kind: 'wall' as const },
      { edgeVertexId: 'v2', kind: 'hedge' as const },
    ];

    expect(pruneBoundaryStyles(styles, [{ id: 'v0' }, { id: 'v1' }])).toEqual([
      { edgeVertexId: 'v0', kind: 'wall' },
    ]);
  });
});
