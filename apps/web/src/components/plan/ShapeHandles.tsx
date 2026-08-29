'use client';

import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import type { Point } from '@garden-studio/schema';
import { rotatePoint } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * Corner handles that resize a rectangle about its centre, and a handle above it that turns it.
 * Lifted out of the house footprint so a shed or a set of steps on step 2 gets exactly the same
 * control, rather than a second implementation that drifts.
 *
 * Both handle kinds are derived from the shape rather than from their own drag position, so each
 * one resets itself on every frame — otherwise Konva's drag offset would fight the value the
 * store computes and the handle would creep away from the corner it labels.
 */

/** How far above the top edge the rotate handle floats, in px. */
const ROTATE_ARM = 30;

export function ShapeHandles({
  centre,
  rotation,
  size,
  transform,
  resizable = true,
  rotatable = true,
  minSide,
  onResize,
  onRotate,
  onGestureStart,
  onGestureEnd,
  testIdPrefix,
}: {
  centre: Point;
  rotation: number;
  size: { width: number; depth: number };
  transform: CanvasTransform;
  resizable?: boolean;
  rotatable?: boolean;
  /** Smallest side the handles will produce, in metres. */
  minSide: number;
  onResize: (size: { width: number; depth: number }) => void;
  onRotate: (degrees: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  testIdPrefix: string;
}) {
  const centrePx = metresToPx(centre, transform);
  const half = { x: (size.width / 2) * transform.scale, y: (size.depth / 2) * transform.scale };

  /** Local-frame corner offsets, so handles sit on the bounding box even for a custom outline. */
  const corners = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];

  function resizeFromPointer(stage: Konva.Stage | null) {
    const position = stage?.getPointerPosition();
    if (!position) return;

    // Undo the shape's rotation to read the pointer in its own frame, where width and depth are
    // just twice the offsets from the centre.
    const local = rotatePoint(pxToMetres(position, transform), centre, -rotation);

    onResize({
      width: Math.max(minSide, Math.abs(local.x - centre.x) * 2),
      depth: Math.max(minSide, Math.abs(local.y - centre.y) * 2),
    });
  }

  return (
    <Group x={centrePx.x} y={centrePx.y} rotation={rotation}>
      {/* Small open circles — plainly not the same thing as a lettered boundary corner. */}
      {corners.map((corner, index) => (
        <Circle
          key={index}
          x={corner.x}
          y={corner.y}
          radius={5}
          fill="#ffffff"
          stroke={COLOUR.houseStroke}
          strokeWidth={1.5}
          draggable={resizable}
          listening={resizable}
          data-testid={`${testIdPrefix}-handle-${index}`}
          onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
            event.cancelBubble = true;
          }}
          onDragStart={onGestureStart}
          onDragMove={(event) => {
            resizeFromPointer(event.target.getStage());
            // The handle's position is derived from the shape, so never keep the drag's.
            event.target.position({ x: corner.x, y: corner.y });
          }}
          onDragEnd={(event) => {
            event.target.position({ x: corner.x, y: corner.y });
            onGestureEnd();
          }}
        />
      ))}

      {rotatable ? (
        <>
          <Line
            points={[0, -half.y, 0, -half.y - (ROTATE_ARM - 4)]}
            stroke={COLOUR.handle}
            strokeWidth={1.5}
            listening={false}
          />
          <Circle
            data-testid={`${testIdPrefix}-rotate-handle`}
            x={0}
            y={-half.y - ROTATE_ARM}
            radius={7}
            fill="#ffffff"
            stroke={COLOUR.handle}
            strokeWidth={2}
            draggable
            onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
            }}
            onDragStart={onGestureStart}
            onDragMove={(event) => {
              const position = event.target.getStage()?.getPointerPosition();
              if (position) {
                // The handle sits directly above the shape, so the angle from the centre to the
                // pointer is the rotation, less the quarter turn that "above" already is.
                const angle =
                  (Math.atan2(position.y - centrePx.y, position.x - centrePx.x) * 180) / Math.PI;
                onRotate(angle + 90);
              }
              event.target.position({ x: 0, y: -half.y - ROTATE_ARM });
            }}
            onDragEnd={(event) => {
              event.target.position({ x: 0, y: -half.y - ROTATE_ARM });
              onGestureEnd();
            }}
          />
        </>
      ) : null}
    </Group>
  );
}
