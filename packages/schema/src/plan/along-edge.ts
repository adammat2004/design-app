import { edgeLength, type Point } from '../geometry/primitives.js';

/**
 * Arithmetic for a thing that sits *along* a segment: "3.2 m from this end, 0.9 m wide".
 *
 * A gate on a boundary edge and a door on a house wall are both stored that way, and until now
 * each resolver did the sums itself. Sharing them here is not about saving lines — it is that
 * the rules for what happens to an offset when the segment under it changes (it is split, it is
 * lengthened from one end, the whole plan is rescaled) have to be the *same* rules for both, or
 * a corner insert would treat a gate one way and a door another.
 *
 * Nothing here knows what a gate or an opening is. Everything takes a segment and numbers, so it
 * stays a leaf module that `gates.ts` and `openings.ts` can both import without a cycle.
 *
 * ## Metres from the start, never a fraction
 *
 * An offset is metres to the attachment's **centre**, measured from the segment's start. A
 * fraction of the length looks tidier and is wrong: stretch a 6 m side to 12 m and a gate stored
 * at 0.7 slides 3.6 m along the fence, where a gate stored at 4.2 m stays with the corner it was
 * hung from. The one change a fraction would survive better — a uniform rescale of the whole
 * plot — is handled by name in `scaleOffsets`, because there the intent really is "everything
 * proportionally".
 */

export type Segment = [Point, Point];

/** Below this a segment has no direction, and nothing can sit on it. */
export const MIN_SEGMENT_LENGTH = 1e-6;

/**
 * How far off a merged edge a projected attachment may land and still be carried across.
 *
 * Deleting a corner that was (nearly) on a straight side is the common case, and there the old
 * centre lands on the new edge to within floating point. A genuinely bent corner throws it
 * metres off, and half a metre is comfortably between the two.
 */
export const MERGE_TOLERANCE = 0.5;

export function segmentLength(segment: Segment): number {
  return edgeLength(segment[0], segment[1]);
}

/** Unit vector along the segment, or `null` when it has no length to speak of. */
export function segmentDirection(segment: Segment): Point | null {
  const length = segmentLength(segment);
  if (length < MIN_SEGMENT_LENGTH) return null;

  return { x: (segment[1].x - segment[0].x) / length, y: (segment[1].y - segment[0].y) / length };
}

/** The point `offset` metres from the segment's start, unclamped. */
export function pointAtOffset(segment: Segment, offset: number): Point | null {
  const unit = segmentDirection(segment);
  if (!unit) return null;

  return { x: segment[0].x + unit.x * offset, y: segment[0].y + unit.y * offset };
}

/**
 * The two ends of a `width`-wide thing centred `offset` metres along the segment, or `null` if
 * it would overhang either end.
 *
 * Refusing rather than clamping is the whole point: a resize that shortens the segment under an
 * attachment must leave it *unplaced* — not resolved to somewhere plausible — so the caller can
 * say so instead of drawing a door hanging off the end of the building.
 */
export function spanOnSegment(segment: Segment, offset: number, width: number): Segment | null {
  const length = segmentLength(segment);
  if (length < MIN_SEGMENT_LENGTH) return null;

  const half = width / 2;
  const from = offset - half;
  const to = offset + half;
  if (from < -MIN_SEGMENT_LENGTH || to > length + MIN_SEGMENT_LENGTH) return null;

  const unit = {
    x: (segment[1].x - segment[0].x) / length,
    y: (segment[1].y - segment[0].y) / length,
  };

  return [
    { x: segment[0].x + unit.x * from, y: segment[0].y + unit.y * from },
    { x: segment[0].x + unit.x * to, y: segment[0].y + unit.y * to },
  ];
}

/** Whether a span of this width at this offset lies wholly on a segment of this length. */
export function spanFits(length: number, offset: number, width: number): boolean {
  const half = width / 2;
  return offset - half >= -MIN_SEGMENT_LENGTH && offset + half <= length + MIN_SEGMENT_LENGTH;
}

/** Whether two spans share any width. Touching is fine. */
export function spansOverlap(a: [number, number], b: [number, number]): boolean {
  return !(a[1] <= b[0] + MIN_SEGMENT_LENGTH || a[0] >= b[1] - MIN_SEGMENT_LENGTH);
}

/**
 * The nearest offset that keeps a thing of this width wholly on a segment of this length.
 *
 * A segment shorter than the thing has no offset that works; centring is the least wrong answer
 * and leaves it visibly unplaced (`spanOnSegment` still refuses it).
 */
export function clampOffset(length: number, width: number, desired: number): number {
  const half = width / 2;
  if (width > length) return length / 2;

  return Math.min(length - half, Math.max(half, desired));
}

/** Which end of a span a resize is dragging. */
export type SpanEnd = 'from' | 'to';

/**
 * The span an end-handle drag produces: the dragged end follows the pointer, the other stays put.
 *
 * This is what makes a resize on the plan read as a resize rather than as a move — grab the left
 * edge of a gate and the right edge must not budge. Both ends are then clamped into the segment,
 * so dragging past a corner stops at it, and a result narrower than `minWidth` is **refused**
 * rather than pinned at the minimum: a gate squeezed to nothing is a mistake, and stopping dead
 * shows the user they have hit a limit where silently holding at 0.6 m would not.
 */
export function spanFromDraggedEnd(
  span: [number, number],
  end: SpanEnd,
  at: number,
  minWidth: number,
  length: number,
): { offset: number; width: number } | null {
  const from = end === 'from' ? at : span[0];
  const to = end === 'to' ? at : span[1];

  const clampedFrom = Math.max(0, Math.min(from, length));
  const clampedTo = Math.max(0, Math.min(to, length));

  const width = clampedTo - clampedFrom;
  if (width < minWidth - MIN_SEGMENT_LENGTH) return null;

  return { offset: (clampedFrom + clampedTo) / 2, width };
}

/**
 * Where a point lands along the segment: the scalar projection from the start, in metres, and
 * how far off the line it sits. Unclamped, so a point past either end reports an offset outside
 * `[0, length]` rather than a lie about being on it.
 */
export function projectOntoSegment(
  segment: Segment,
  point: Point,
): { offset: number; distance: number } | null {
  const unit = segmentDirection(segment);
  if (!unit) return null;

  const dx = point.x - segment[0].x;
  const dy = point.y - segment[0].y;
  const offset = dx * unit.x + dy * unit.y;
  const distance = Math.abs(dx * unit.y - dy * unit.x);

  return { offset, distance };
}

/** The offset along the segment nearest to a pointer, unclamped. What a drag reads. */
export function offsetOfPoint(segment: Segment, point: Point): number | null {
  return projectOntoSegment(segment, point)?.offset ?? null;
}

/**
 * Which half an attachment lands on when its segment is cut `firstHalf` metres from the start,
 * and its offset measured from that half's own start.
 *
 * Split by the *centre*: a thing straddling the cut has no home and is put on whichever side
 * holds most of it, then clamped by the caller. That can move it by up to half its width, which
 * is the price of inserting a corner through a gate and is small enough to see and undo.
 */
export function offsetAfterSplit(
  offset: number,
  firstHalf: number,
): { half: 'first' | 'second'; offset: number } {
  return offset > firstHalf
    ? { half: 'second', offset: offset - firstHalf }
    : { half: 'first', offset };
}

/**
 * The offset that keeps an attachment the same distance from the segment's **end** after the
 * segment changes length from its start.
 *
 * Offsets are from the start, so when the start is what moves the stored number has to move
 * with it or the gate slides along the fence. This is the closing edge's case in `setEdgeLength`
 * and nowhere else: every other side is lengthened from its far end and needs nothing.
 */
export function offsetFromEndPreserved(
  offset: number,
  oldLength: number,
  newLength: number,
): number {
  return offset + (newLength - oldLength);
}

/**
 * Every offset multiplied by `factor`; widths untouched.
 *
 * A rescale is the one change where "keep it the same distance from the corner" is wrong: a plot
 * drawn ten times too big has its gate ten times too far along the fence. The gate itself is
 * still 0.9 m wide — it is a product, not a proportion — which is why widths are left alone and
 * anything that then no longer fits is left unplaced rather than shrunk.
 */
export function scaleOffsets<T extends { offsetAlongEdge: number }>(
  items: T[],
  factor: number,
): T[] {
  return items.map((item) => ({ ...item, offsetAlongEdge: item.offsetAlongEdge * factor }));
}

/**
 * Where an attachment on an edge that is being deleted would land on the edge that replaces
 * it, or `null` when it would not: off the end, or further from the line than `tolerance`.
 *
 * Used when a corner is removed and two edges become one. The old centre is a real point on the
 * plan; if the new straight edge passes through it — which it does whenever the corner was
 * redundant — the attachment is carried across losslessly. If the corner was a real bend the
 * point is out in the garden somewhere and there is nothing honest to do but drop it.
 */
export function carryOntoSegment(
  oldCentre: Point,
  merged: Segment,
  width: number,
  tolerance: number = MERGE_TOLERANCE,
): number | null {
  const projected = projectOntoSegment(merged, oldCentre);
  if (!projected || projected.distance > tolerance) return null;
  if (!spanFits(segmentLength(merged), projected.offset, width)) return null;

  return projected.offset;
}
