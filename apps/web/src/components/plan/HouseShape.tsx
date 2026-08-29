'use client';

import { Group, Line, Path, Text } from 'react-konva';
import type Konva from 'konva';
import type { Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import {
  metresToPx,
  polygonToKonvaPoints,
  pxToMetres,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { MIN_HOUSE_SIDE } from '@/lib/house';
import { formatLength, type Unit } from '@/lib/units';
import { ShapeHandles } from './ShapeHandles';

/**
 * The footprint, its caption, and — when selected — corner handles that resize it about its
 * centre and a handle above it that turns it.
 *
 * Shared by both plan screens. Step 1 hands it the callbacks that edit the house; step 2 renders
 * it inert, as locked background context, and gets the same icon, name and dimensions for free
 * rather than drawing a bare grey rectangle of its own.
 */

/** A 24x24 house glyph, matching the lucide icon used everywhere else for the building. */
const HOUSE_GLYPH = 'M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z';
const GLYPH_SIZE = 24;
const GLYPH_SCALE = 0.62;

export function HouseShape({
  outline,
  centre,
  rotation,
  size,
  unit,
  transform,
  selected = false,
  draggable = false,
  resizable = false,
  onSelect,
  onMoveLive,
  onResize,
  onRotate,
  onGestureStart,
  onGestureEnd,
}: {
  outline: Point[];
  centre: Point;
  rotation: number;
  size: { width: number; depth: number };
  unit: Unit;
  transform: CanvasTransform;
  selected?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  onSelect?: () => void;
  onMoveLive?: (centre: Point) => void;
  onResize?: (size: { width: number; depth: number }) => void;
  onRotate?: (degrees: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const centrePx = metresToPx(centre, transform);
  const glyph = (GLYPH_SIZE * GLYPH_SCALE) / 2;

  return (
    <Group>
      <Line
        data-testid="house-shape"
        points={polygonToKonvaPoints(outline, transform)}
        closed
        fill={COLOUR.houseFill}
        stroke={selected ? COLOUR.handle : COLOUR.houseStroke}
        strokeWidth={selected ? 2.5 : 1.5}
        // Inert on step 2: the property was settled on step 1 and is context here.
        listening={draggable || !!onSelect}
        draggable={draggable}
        onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
          event.cancelBubble = true;
          onSelect?.();
        }}
        onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
          event.cancelBubble = true;
        }}
        onDragStart={() => {
          onSelect?.();
          onGestureStart?.();
        }}
        onDragMove={(event) => {
          // The Line's own points are absolute, so its drag offset is the delta to apply.
          const node = event.target;
          const delta = pxToMetres({ x: node.x(), y: node.y() }, transform);
          const origin = pxToMetres({ x: 0, y: 0 }, transform);

          onMoveLive?.({
            x: centre.x + (delta.x - origin.x),
            y: centre.y + (delta.y - origin.y),
          });
          node.position({ x: 0, y: 0 });
        }}
        onDragEnd={(event) => {
          event.target.position({ x: 0, y: 0 });
          onGestureEnd?.();
        }}
      />

      <Group x={centrePx.x} y={centrePx.y} rotation={rotation} listening={false}>
        <Path
          data={HOUSE_GLYPH}
          stroke={COLOUR.houseInk}
          strokeWidth={1.8}
          lineJoin="round"
          lineCap="round"
          scaleX={GLYPH_SCALE}
          scaleY={GLYPH_SCALE}
          // Konva paths draw from their own origin, so shift by half the scaled glyph to centre
          // it, then lift it clear of the two lines of text below.
          offsetX={glyph / GLYPH_SCALE}
          offsetY={(glyph + 26) / GLYPH_SCALE}
          opacity={0.85}
        />
        <Text
          text="House"
          fontSize={13}
          fontStyle="600"
          fill={COLOUR.houseInk}
          width={200}
          offsetX={100}
          offsetY={16}
          align="center"
        />
        <Text
          text={`${formatLength(size.width, unit)} × ${formatLength(size.depth, unit)}`}
          fontSize={11}
          fill={COLOUR.houseInk}
          width={200}
          offsetX={100}
          offsetY={0}
          align="center"
          opacity={0.8}
        />
      </Group>

      {selected && onResize && onRotate && onGestureStart && onGestureEnd ? (
        <ShapeHandles
          centre={centre}
          rotation={rotation}
          size={size}
          transform={transform}
          resizable={resizable}
          minSide={MIN_HOUSE_SIDE}
          onResize={onResize}
          onRotate={onRotate}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          testIdPrefix="house"
        />
      ) : null}
    </Group>
  );
}
