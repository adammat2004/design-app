'use client';

import { Circle, Group, Text } from 'react-konva';
import type Konva from 'konva';
import type { Point } from '@garden-studio/schema';
import { vertexLabel } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * Draggable corner handles for any editable outline — the property boundary on step 1, a patio
 * or a path being reshaped on step 2.
 *
 * The two uses look deliberately different. A boundary corner is a solid green lettered disc,
 * because it is one of the half dozen points that define the whole property. A feature vertex is
 * a small open dot, because there may be a dozen of them on one patio and they must not compete
 * with the boundary for the same meaning.
 */

export type VertexVariant = 'boundary' | 'feature';

/** Radius in px. The boundary's is large enough to hit comfortably on a touch screen. */
export const BOUNDARY_HANDLE_RADIUS = 14;
const FEATURE_HANDLE_RADIUS = 6;

export interface EditableVertex extends Point {
  id: string;
}

export function EditableVertices({
  vertices,
  transform,
  variant,
  selectedId = null,
  draggable = true,
  listening = true,
  onVertexDragStart,
  onVertexDragMove,
  onVertexDragEnd,
  onVertexClick,
  testIdPrefix,
}: {
  vertices: EditableVertex[];
  transform: CanvasTransform;
  variant: VertexVariant;
  selectedId?: string | null;
  draggable?: boolean;
  listening?: boolean;
  onVertexDragStart?: (id: string) => void;
  onVertexDragMove?: (id: string, at: Point) => void;
  onVertexDragEnd?: (id: string) => void;
  onVertexClick?: (id: string, at: Point) => void;
  /** Boundary handles are addressed by letter (`vertex-A`), feature handles by index. */
  testIdPrefix: string;
}) {
  const boundary = variant === 'boundary';
  const radius = boundary ? BOUNDARY_HANDLE_RADIUS : FEATURE_HANDLE_RADIUS;

  return (
    <>
      {vertices.map((vertex, index) => {
        const position = metresToPx(vertex, transform);
        const isSelected = vertex.id === selectedId;
        const testId = boundary
          ? `${testIdPrefix}-${vertexLabel(index)}`
          : `${testIdPrefix}-${index}`;

        return (
          <Group
            key={vertex.id}
            x={position.x}
            y={position.y}
            draggable={draggable}
            listening={listening}
            onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
            }}
            onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
              onVertexClick?.(vertex.id, { x: vertex.x, y: vertex.y });
            }}
            onDragStart={() => onVertexDragStart?.(vertex.id)}
            onDragMove={(event) => {
              const node = event.target;
              onVertexDragMove?.(vertex.id, pxToMetres({ x: node.x(), y: node.y() }, transform));
            }}
            onDragEnd={() => onVertexDragEnd?.(vertex.id)}
          >
            {boundary ? (
              <>
                {/*
                  Solid green with a white letter — deliberately unlike the house's small open
                  resize handles, so "boundary corner you can move" and "house handle" never
                  read as the same control.
                */}
                <Circle
                  data-testid={testId}
                  radius={radius}
                  fill={COLOUR.stroke}
                  stroke={isSelected ? COLOUR.handle : '#ffffff'}
                  strokeWidth={isSelected ? 3 : 2}
                  shadowColor="rgba(20, 40, 24, 0.3)"
                  shadowBlur={isSelected ? 8 : 3}
                  shadowOpacity={1}
                />
                <Text
                  text={vertexLabel(index)}
                  fontSize={12}
                  fontStyle="600"
                  fill="#ffffff"
                  width={radius * 2}
                  height={radius * 2}
                  offsetX={radius}
                  offsetY={radius}
                  align="center"
                  verticalAlign="middle"
                  listening={false}
                />
              </>
            ) : (
              <Circle
                data-testid={testId}
                radius={radius}
                fill="#ffffff"
                stroke={COLOUR.handle}
                strokeWidth={2}
                // Small enough to sit on a busy shape, so widen the hit area rather than the dot.
                hitStrokeWidth={12}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}
