'use client';

import { useRef } from 'react';
import { formatLength, type Unit } from '@/lib/units';

/**
 * A segment unrolled flat, with what sits on it drawn along its length.
 *
 * Extracted from the wall elevation strip so a side of the property gets the same control. The
 * argument is the same in both places: placing a 900 mm door — or a 900 mm gate — on a drawing
 * where the whole building is a couple of centimetres across is an unreasonable ask, and unrolling
 * the thing it sits on turns a hard 2D task into an easy 1D one.
 *
 * **The horizontal axis is metres from the segment's start**, which is exactly what
 * `offsetAlongEdge` stores — the number under the pointer and the number in the document are the
 * same number, and that is the whole reason it is legible.
 *
 * Deliberately plain DOM rather than Konva. It is a ruler with draggable blocks on it, which React
 * handles better than a canvas, and it keeps the panel out of the `ssr: false` dance every canvas
 * in this app needs. The vertical axis is the caller's business: a wall draws its openings at
 * their true height against a storey, a fence draws a full-height block, because a gate has no
 * elevation worth claiming.
 */

/** Sliding snaps to this, in metres — fine enough to be exact, coarse enough to be steady. */
const SLIDE_STEP = 0.05;

export interface TrackItem {
  id: string;
  /** Metres from the segment's start to this item's centre. */
  offset: number;
  width: number;
  label: string;
  selected: boolean;
  /** 0-1 of the track's height. Defaults to the full height, which is what a gate wants. */
  heightRatio?: number;
  /** 0-1 of the track's height, from the bottom. Defaults to standing on the ground. */
  bottomRatio?: number;
}

/**
 * Where along the segment a pointer is, in metres. Pure so it can be tested without a layout, and
 * used by the drag itself so the test covers the arithmetic that actually runs.
 */
export function pointerOffset(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  segmentLengthMetres: number,
): number {
  if (trackWidth <= 0) return 0;

  const metres = ((clientX - trackLeft) / trackWidth) * segmentLengthMetres;
  return Math.round(metres / SLIDE_STEP) * SLIDE_STEP;
}

export function SegmentTrack({
  length,
  items,
  unit,
  caption,
  testId,
  itemTestId,
  onSelect,
  onGestureStart,
  onMove,
  onGestureEnd,
}: {
  length: number;
  items: TrackItem[];
  unit: Unit;
  /** What the reader is looking at, in words. */
  caption: string;
  testId: string;
  itemTestId: (id: string) => string;
  onSelect: (id: string) => void;
  onGestureStart: () => void;
  onMove: (id: string, offset: number) => void;
  onGestureEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  function offsetFromPointer(clientX: number): number {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return 0;

    return pointerOffset(clientX, box.left, box.width, length);
  }

  /*
   * The move and up listeners go on the window rather than on the block, which is what keeps the
   * drag alive when the pointer runs off the end of the track — the common case, since sliding a
   * door to the corner means aiming past it. That also makes `setPointerCapture` redundant, which
   * is just as well: it is one of the DOM APIs jsdom does not implement.
   */
  function startSlide(id: string) {
    onSelect(id);
    onGestureStart();

    const onPointerMove = (event: PointerEvent) => onMove(id, offsetFromPointer(event.clientX));

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      onGestureEnd();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  const safeLength = Math.max(length, 1e-6);

  return (
    <div>
      <div
        ref={trackRef}
        data-testid={testId}
        className="relative h-24 overflow-hidden rounded-md border border-garden-line bg-garden-sage/25"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={itemTestId(item.id)}
            data-selected={item.selected}
            aria-label={`${item.label} at ${formatLength(item.offset, unit)}`}
            onPointerDown={() => startSlide(item.id)}
            style={{
              left: `${((item.offset - item.width / 2) / safeLength) * 100}%`,
              width: `${(item.width / safeLength) * 100}%`,
              height: `${(item.heightRatio ?? 1) * 100}%`,
              bottom: `${(item.bottomRatio ?? 0) * 100}%`,
            }}
            className={[
              'absolute cursor-ew-resize touch-none rounded-sm border-2',
              item.selected
                ? 'border-garden-forest bg-garden-green/40'
                : 'border-garden-green bg-garden-green/20 hover:bg-garden-green/30',
            ].join(' ')}
          />
        ))}

        {/* The ground the blocks stand on, so they read as being at a height. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-garden-muted" />
      </div>

      {/* The ruler, in the same metres as `offsetAlongEdge`. */}
      <div
        data-testid={`${testId}-ruler`}
        className="mt-1 flex justify-between text-[9px] text-garden-muted"
      >
        <span>0</span>
        <span>{formatLength(length / 2, unit)}</span>
        <span>{formatLength(length, unit)}</span>
      </div>

      <p className="mt-1 text-center text-[10px] text-garden-muted">{caption}</p>
    </div>
  );
}
