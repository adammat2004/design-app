'use client';

import { Arrow, Circle, Group, Line, Rect } from 'react-konva';
import type { Point } from '@garden-studio/schema';
import type { RunFrame, RunOverlay } from '@/lib/ai-run/evaluate';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, polygonToKonvaPoints, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * What the AI designer is doing, drawn over the plan and never in it.
 *
 * Everything here comes off `RunFrame`, which is derived from the clock and thrown away — no
 * overlay is ever an element, and deleting this file leaves the redesign working and silent. That
 * separation is the point: the plan is the document, and this is somebody working on it.
 *
 * The vocabulary is a drawing office's, not a science fiction film's: a selection outline with
 * handles, a dashed destination, an arrow, vertices on the outline being edited, a route set out
 * before it is built, an inspection frame, a crosshair. Anything that reads as "computer" rather
 * than as "designer" is the wrong answer, because the claim being made is that a professional is
 * operating the same editor the user has.
 *
 * A group on the AI's own layer (see `EditorCanvas`), above `MotionGroup` on the same layer. The
 * `!frame` guard stays although that layer only mounts with a frame: the component is total either
 * way, and a caller should not have to know how the layer is gated.
 */

const HANDLE = 5;

export function AiOverlayGroup({
  frame,
  transform,
}: {
  frame: RunFrame | null;
  transform: CanvasTransform;
}) {
  if (!frame) return null;

  return (
    <Group listening={false}>
      {frame.overlays.map((overlay) => (
        <Overlay key={overlay.key} overlay={overlay} transform={transform} />
      ))}
      {frame.cursor ? <Cursor at={frame.cursor} transform={transform} /> : null}
    </Group>
  );
}

function Overlay({ overlay, transform }: { overlay: RunOverlay; transform: CanvasTransform }) {
  if (overlay.alpha <= 0.01) return null;

  switch (overlay.kind) {
    case 'selection': {
      const box = boxPx(overlay.box, transform);
      return (
        <Group opacity={overlay.alpha} listening={false}>
          <Line
            points={polygonToKonvaPoints(overlay.outline, transform)}
            closed
            fill={COLOUR.aiWash}
            stroke={COLOUR.ai}
            strokeWidth={1.5}
            lineJoin="round"
          />
          {/*
            Handles on a rectangle only, and they are drawn rather than usable.
            A shape the AI is working on shows the same grips the user's own selection shows, which
            is what makes "it is operating your editor" a claim the canvas supports rather than one
            the panel merely asserts.
          */}
          {overlay.handles
            ? corners(box).map((corner, index) => (
                <Rect
                  key={index}
                  x={corner.x - HANDLE}
                  y={corner.y - HANDLE}
                  width={HANDLE * 2}
                  height={HANDLE * 2}
                  fill="#ffffff"
                  stroke={COLOUR.ai}
                  strokeWidth={1.5}
                />
              ))
            : null}
        </Group>
      );
    }

    case 'ghost': {
      const from = metresToPx(overlay.from, transform);
      const to = metresToPx(overlay.to, transform);
      const tail = {
        x: from.x + (to.x - from.x) * overlay.travel,
        y: from.y + (to.y - from.y) * overlay.travel,
      };
      return (
        <Group opacity={overlay.alpha} listening={false}>
          <Line
            points={polygonToKonvaPoints(overlay.outline, transform)}
            closed
            stroke={COLOUR.ai}
            strokeWidth={1.2}
            dash={[6, 5]}
          />
          <Arrow
            points={[tail.x, tail.y, to.x, to.y]}
            stroke={COLOUR.ai}
            fill={COLOUR.ai}
            strokeWidth={1.2}
            dash={[4, 4]}
            pointerLength={8}
            pointerWidth={7}
          />
        </Group>
      );
    }

    case 'vertices':
      return (
        <Group opacity={overlay.alpha} listening={false}>
          {overlay.points.map((point, index) => {
            const at = metresToPx(point, transform);
            return (
              <Circle
                key={index}
                x={at.x}
                y={at.y}
                radius={4}
                fill="#ffffff"
                stroke={COLOUR.ai}
                strokeWidth={1.5}
              />
            );
          })}
        </Group>
      );

    case 'route': {
      /* The line is set out before it is built, which is the order a path is actually designed in. */
      const points = polygonToKonvaPoints(overlay.points, transform);
      return (
        <Group opacity={overlay.alpha} listening={false}>
          <Line points={points} stroke={COLOUR.ai} strokeWidth={1.4} dash={[7, 5]} lineJoin="round" />
          {overlay.points.map((point, index) => {
            const at = metresToPx(point, transform);
            const shown = Math.max(0, Math.min(1, (overlay.reveal - index / overlay.points.length) * 3));
            return shown <= 0 ? null : (
              <Circle
                key={index}
                x={at.x}
                y={at.y}
                radius={4.5 * shown}
                fill="#ffffff"
                stroke={COLOUR.ai}
                strokeWidth={1.5}
              />
            );
          })}
        </Group>
      );
    }

    case 'frame': {
      const box = boxPx(overlay.box, transform, 8);
      return (
        <Group opacity={overlay.alpha} listening={false}>
          <Rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            stroke={COLOUR.ai}
            strokeWidth={1.2}
            dash={[8, 5]}
          />
          {corners(box).map((corner, index) => (
            <Group key={index}>
              <Line points={[corner.x - 6, corner.y, corner.x + 6, corner.y]} stroke={COLOUR.ai} strokeWidth={1.6} />
              <Line points={[corner.x, corner.y - 6, corner.x, corner.y + 6]} stroke={COLOUR.ai} strokeWidth={1.6} />
            </Group>
          ))}
        </Group>
      );
    }

    case 'scan': {
      const y = metresToPx({ x: 0, y: overlay.y }, transform).y;
      return (
        <Line
          points={[-2000, y, 4000, y]}
          stroke={COLOUR.ai}
          strokeWidth={1.5}
          opacity={overlay.alpha}
          listening={false}
        />
      );
    }
  }
}

/** The crosshair. A drawing-office cursor rather than a pointer: it marks a place, not a click. */
function Cursor({ at, transform }: { at: Point; transform: CanvasTransform }) {
  const centre = metresToPx(at, transform);
  const arm = 14;

  return (
    <Group x={centre.x} y={centre.y} listening={false}>
      <Line points={[-arm * 1.8, 0, -arm * 0.6, 0]} stroke={COLOUR.ai} strokeWidth={1.5} />
      <Line points={[arm * 0.6, 0, arm * 1.8, 0]} stroke={COLOUR.ai} strokeWidth={1.5} />
      <Line points={[0, -arm * 1.8, 0, -arm * 0.6]} stroke={COLOUR.ai} strokeWidth={1.5} />
      <Line points={[0, arm * 0.6, 0, arm * 1.8]} stroke={COLOUR.ai} strokeWidth={1.5} />
      <Circle radius={arm * 0.55} stroke={COLOUR.ai} strokeWidth={1.5} />
      <Circle radius={2} fill={COLOUR.ai} />
    </Group>
  );
}

function boxPx(
  box: { minX: number; minY: number; width: number; length: number },
  transform: CanvasTransform,
  pad = 4,
) {
  const topLeft = metresToPx({ x: box.minX, y: box.minY }, transform);
  return {
    x: topLeft.x - pad,
    y: topLeft.y - pad,
    width: box.width * transform.scale + pad * 2,
    height: box.length * transform.scale + pad * 2,
  };
}

function corners(box: { x: number; y: number; width: number; height: number }): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
}
