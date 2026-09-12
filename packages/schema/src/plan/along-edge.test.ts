import { describe, expect, it } from 'vitest';
import {
  carryOntoSegment,
  clampOffset,
  MERGE_TOLERANCE,
  offsetAfterSplit,
  offsetFromEndPreserved,
  offsetOfPoint,
  projectOntoSegment,
  scaleOffsets,
  spanFits,
  spanFromDraggedEnd,
  spanOnSegment,
  spansOverlap,
  type Segment,
} from './along-edge.js';

/** A 10 m side running along +x from the origin. */
const SIDE: Segment = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe('spanOnSegment', () => {
  it('centres the span on the offset', () => {
    expect(spanOnSegment(SIDE, 4, 2)).toEqual([
      { x: 3, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('allows a span flush with either end', () => {
    expect(spanOnSegment(SIDE, 1, 2)).not.toBeNull();
    expect(spanOnSegment(SIDE, 9, 2)).not.toBeNull();
  });

  it('refuses one that overhangs, rather than clamping it', () => {
    // The whole point: a shortened side leaves its gate *unplaced*, never resolved somewhere
    // plausible.
    expect(spanOnSegment(SIDE, 0.5, 2)).toBeNull();
    expect(spanOnSegment(SIDE, 9.6, 2)).toBeNull();
  });

  it('refuses a segment with no length', () => {
    expect(spanOnSegment([SIDE[0], SIDE[0]], 0, 1)).toBeNull();
  });
});

describe('spanFits and spansOverlap', () => {
  it('agree with spanOnSegment about the ends', () => {
    expect(spanFits(10, 1, 2)).toBe(true);
    expect(spanFits(10, 0.5, 2)).toBe(false);
  });

  it('let two spans touch but not share width', () => {
    expect(spansOverlap([2, 4], [4, 6])).toBe(false);
    expect(spansOverlap([2, 4], [3.9, 6])).toBe(true);
  });
});

describe('clampOffset', () => {
  it('keeps the span wholly on the segment', () => {
    expect(clampOffset(10, 2, -3)).toBe(1);
    expect(clampOffset(10, 2, 30)).toBe(9);
    expect(clampOffset(10, 2, 5)).toBe(5);
  });

  it('centres a thing wider than the segment, which leaves it visibly unplaced', () => {
    expect(clampOffset(1, 2, 0.2)).toBe(0.5);
    expect(spanFits(1, 0.5, 2)).toBe(false);
  });
});

describe('projectOntoSegment', () => {
  it('reads the offset along and the distance off the line', () => {
    expect(projectOntoSegment(SIDE, { x: 3, y: 2 })).toEqual({ offset: 3, distance: 2 });
  });

  it('does not clamp: a point past the end says so', () => {
    expect(offsetOfPoint(SIDE, { x: 14, y: 0 })).toBe(14);
    expect(offsetOfPoint(SIDE, { x: -1, y: 0 })).toBe(-1);
  });

  it('works on a side at an angle', () => {
    const diagonal: Segment = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(offsetOfPoint(diagonal, { x: 3, y: 4 })).toBeCloseTo(5);
    expect(projectOntoSegment(diagonal, { x: -4, y: 3 })!.distance).toBeCloseTo(5);
  });
});

describe('spanFromDraggedEnd', () => {
  // A 2 m thing centred at 5 on a 10 m segment: from 4, to 6.
  const span: [number, number] = [4, 6];

  it('moves the dragged end and leaves the other where it was', () => {
    expect(spanFromDraggedEnd(span, 'from', 3, 0.6, 10)).toEqual({ offset: 4.5, width: 3 });
    expect(spanFromDraggedEnd(span, 'to', 9, 0.6, 10)).toEqual({ offset: 6.5, width: 5 });
  });

  it('stops at the corner rather than running past it', () => {
    expect(spanFromDraggedEnd(span, 'from', -4, 0.6, 10)).toEqual({ offset: 3, width: 6 });
    expect(spanFromDraggedEnd(span, 'to', 14, 0.6, 10)).toEqual({ offset: 7, width: 6 });
  });

  /*
   * Refused rather than pinned at the minimum: stopping dead shows the user they have hit a limit,
   * where silently holding the width would look like the drag simply stopped tracking.
   */
  it('refuses a span squeezed below the minimum', () => {
    expect(spanFromDraggedEnd(span, 'from', 5.8, 0.6, 10)).toBeNull();
    expect(spanFromDraggedEnd(span, 'to', 4.2, 0.6, 10)).toBeNull();
  });

  it('allows a span exactly at the minimum', () => {
    // Floating point puts 6 − 5.4 a hair under 0.6, which is what the tolerance is there for.
    const result = spanFromDraggedEnd(span, 'from', 5.4, 0.6, 10);
    expect(result!.width).toBeCloseTo(0.6);
    expect(result!.offset).toBeCloseTo(5.7);
  });
});

describe('offsetAfterSplit', () => {
  it('leaves a thing before the cut on the first half, measured as before', () => {
    expect(offsetAfterSplit(3, 6)).toEqual({ half: 'first', offset: 3 });
  });

  it('moves a thing beyond the cut to the second half, measured from the new corner', () => {
    expect(offsetAfterSplit(8, 6)).toEqual({ half: 'second', offset: 2 });
  });

  it('puts a thing exactly on the cut on the first half', () => {
    expect(offsetAfterSplit(6, 6).half).toBe('first');
  });
});

describe('offsetFromEndPreserved', () => {
  it('keeps the distance from the far end when the start moves', () => {
    // A gate 2 m from the end of a 10 m side is still 2 m from the end of the 14 m one.
    expect(offsetFromEndPreserved(8, 10, 14)).toBe(12);
    expect(offsetFromEndPreserved(8, 10, 6)).toBe(4);
  });
});

describe('scaleOffsets', () => {
  it('scales the offset and leaves the width alone', () => {
    // A gate is a product, not a proportion: a tenth-size plot still has a 0.9 m gate.
    const [scaled] = scaleOffsets([{ id: 'g1', offsetAlongEdge: 12, width: 0.9 }], 0.1);
    expect(scaled!.offsetAlongEdge).toBeCloseTo(1.2);
    expect(scaled!.width).toBe(0.9);
    expect(scaled!.id).toBe('g1');
  });
});

describe('carryOntoSegment', () => {
  const merged: Segment = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ];

  it('carries a thing whose old centre lies on the merged edge', () => {
    // A corner that was redundant: the old edge ran along the same line.
    expect(carryOntoSegment({ x: 14, y: 0 }, merged, 1)).toBe(14);
  });

  it('tolerates a corner that was very nearly on the line', () => {
    expect(carryOntoSegment({ x: 14, y: MERGE_TOLERANCE / 2 }, merged, 1)).toBe(14);
  });

  it('drops a thing that was on a real bend', () => {
    // The old centre is metres into the garden; the straight line does not pass through it.
    expect(carryOntoSegment({ x: 14, y: 3 }, merged, 1)).toBeNull();
  });

  it('drops a thing that would land off the end or not fit', () => {
    expect(carryOntoSegment({ x: 21, y: 0 }, merged, 1)).toBeNull();
    expect(carryOntoSegment({ x: 19.8, y: 0 }, merged, 1)).toBeNull();
  });
});
