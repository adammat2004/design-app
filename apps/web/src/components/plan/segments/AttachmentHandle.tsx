'use client';

import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { offsetOfPoint, type Point, type SpanEnd } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * A thing that sits along a segment, made draggable *on that segment*.
 *
 * One component for a gate in a fence and a door in a wall, because the gesture is identical:
 * grab the middle and it slides along, grab an end and that end moves while the other stays put,
 * and neither can leave the segment it belongs to. The difference between the two — what is legal,
 * what it is called, how wide it may be — lives in the store actions this is handed, so nothing
 * here knows what a gate is.
 *
 * **It cannot leave its segment by construction, not by clamping.** The pointer is projected onto
 * the parent segment with `offsetOfPoint` and only that distance is passed on; the position off
 * the line is thrown away. A drag out into the garden slides the gate to the nearest point of its
 * fence, which is the only sensible reading of the gesture, and there is no frame in which the
 * gate is somewhere it could not be.
 *
 * Handles are fixed pixels, like `ShapeHandles`: they are furniture for the pointer, not things
 * with a real size. They also reset their own position every frame, because Konva writes the
 * dragged node's coordinates directly and React's next render has to win.
 */

/** Radius of an end handle, in pixels. Matches `ShapeHandles`' corner handles. */
const END_RADIUS = 6;

/** Extra grab room round an end handle, so its reach is `END_RADIUS + END_HIT / 2`. */
const END_HIT = 16;

/**
 * How much span it takes before end handles are offered at all, in pixels.
 *
 * Not "enough that they do not overlap each other" — that was the first rule and it is too
 * generous by half. Each end's grab area reaches about 14 px, so on a gate 30 px wide (which is
 * what a 900 mm gate *is* at plan zoom) the two of them swallow the middle, and every attempt to
 * slide the gate silently resized it instead: the first drag of a real gate on a real plan turned
 * a 0.9 m gate into a 0.7 m one. The threshold leaves a clear body between them to grab.
 *
 * The consequence is deliberate and reads correctly: a small gate is move-only until you zoom in,
 * and its width is typed — 0.9, 1.2, 3.0 are catalogue numbers, not things you drag to. Ends earn
 * their place on a driveway, or on anything once the view is close enough to aim at an edge.
 */
const MIN_SPAN_FOR_ENDS_PX = 2 * (END_RADIUS + END_HIT / 2) + 28;

/** A touch target regardless of how thin the thing itself is drawn. */
const HIT_WIDTH = 22;

export function AttachmentHandle({
  segment,
  parent,
  transform,
  selected,
  listening = true,
  onSelect,
  onGestureStart,
  onMove,
  onResize,
  onGestureEnd,
  testId,
}: {
  /** The attachment's own two ends, in world metres. */
  segment: [Point, Point];
  /** The side or wall it runs along — what the pointer is projected onto. */
  parent: [Point, Point];
  transform: CanvasTransform;
  selected: boolean;
  listening?: boolean;
  onSelect: () => void;
  onGestureStart: () => void;
  /** Metres from the parent segment's start to where the centre should go. */
  onMove: (offsetAlongEdge: number) => void;
  /** Metres from the parent segment's start to where the dragged end should go. */
  onResize: (end: SpanEnd, at: number) => void;
  onGestureEnd: () => void;
  testId: string;
}) {
  const from = metresToPx(segment[0], transform);
  const to = metresToPx(segment[1], transform);
  const spanPx = Math.hypot(to.x - from.x, to.y - from.y);
  const showEnds = selected && spanPx >= MIN_SPAN_FOR_ENDS_PX;

  /** Where the pointer has reached along the parent, in metres. */
  function offsetFrom(node: Konva.Node): number | null {
    return offsetOfPoint(parent, pxToMetres({ x: node.x(), y: node.y() }, transform));
  }

  return (
    <Group listening={listening}>
      {/*
        The body. Draggable in both axes and then projected — constraining the drag itself would
        need the segment's angle in pixel space and would fight the viewport's own transform.
      */}
      <Line
        data-testid={testId}
        data-selected={selected}
        points={[from.x, from.y, to.x, to.y]}
        stroke={selected ? COLOUR.handle : 'transparent'}
        strokeWidth={selected ? 3 : 2}
        opacity={selected ? 0.9 : 1}
        lineCap="round"
        hitStrokeWidth={HIT_WIDTH}
        draggable
        onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
          event.cancelBubble = true;
        }}
        onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
          event.cancelBubble = true;
          onSelect();
        }}
        onDragStart={(event: Konva.KonvaEventObject<DragEvent>) => {
          event.cancelBubble = true;
          onSelect();
          onGestureStart();
        }}
        onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
          event.cancelBubble = true;
          const node = event.target;

          /*
           * The line's own points are absolute, so dragging it moves the node away from the origin
           * by the drag delta. The centre is therefore the midpoint plus that delta, projected.
           */
          const centre = {
            x: (from.x + to.x) / 2 + node.x(),
            y: (from.y + to.y) / 2 + node.y(),
          };
          const offset = offsetOfPoint(parent, pxToMetres(centre, transform));
          if (offset !== null) onMove(offset);

          node.position({ x: 0, y: 0 });
        }}
        onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
          event.cancelBubble = true;
          event.target.position({ x: 0, y: 0 });
          onGestureEnd();
        }}
      />

      {showEnds
        ? (['from', 'to'] as const).map((end, index) => {
            const at = index === 0 ? from : to;

            return (
              <Circle
                key={end}
                data-testid={`${testId}-${end}`}
                x={at.x}
                y={at.y}
                radius={END_RADIUS}
                fill="#ffffff"
                stroke={COLOUR.handle}
                strokeWidth={2}
                hitStrokeWidth={END_HIT}
                draggable
                onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
                  event.cancelBubble = true;
                }}
                onDragStart={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  onGestureStart();
                }}
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  const node = event.target;
                  const offset = offsetFrom(node);
                  if (offset !== null) onResize(end, offset);

                  // Back to where the document says it is, which the next render confirms.
                  node.position(at);
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  event.target.position(at);
                  onGestureEnd();
                }}
              />
            );
          })
        : null}
    </Group>
  );
}
