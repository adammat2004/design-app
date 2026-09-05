'use client';

import { useMemo } from 'react';
import { Group, Line, Path, Text } from 'react-konva';
import type Konva from 'konva';
import { insetPolygon, type Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import {
  metresToPx,
  polygonToKonvaPoints,
  pxToMetres,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { MIN_HOUSE_SIDE } from '@/lib/house';
import { LIGHT_DIRECTION, SHADOW_TONE } from '@/lib/materials/light';
import {
  houseGroundShadow,
  HOUSE_SHADOW_ALPHA,
  WALL_THICKNESS,
} from '@/lib/materials/symbols/property';
import { formatLength, type Unit } from '@/lib/units';
import { ShapeHandles } from './ShapeHandles';

/**
 * The footprint, its caption, and — when selected — corner handles that resize it about its
 * centre and a handle above it that turns it.
 *
 * Shared by both plan screens. Step 1 hands it the callbacks that edit the house; step 2 renders
 * it inert, as locked background context, and gets the same icon, name and dimensions for free
 * rather than drawing a bare grey rectangle of its own.
 *
 * Drawn as a building rather than a box: the outline is filled as a wall of real thickness and the
 * inside as flooring, which is what a plan drawing of a house is. The geometry is untouched — the
 * outline everything measures against is exactly the polygon it was — and the inset is derived on
 * every render for the reason zones are: an inner ring stored on the document would go stale the
 * moment a corner moved.
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
  light,
}: {
  outline: Point[];
  centre: Point;
  rotation: number;
  size: { width: number; depth: number };
  unit: Unit;
  transform: CanvasTransform;
  /**
   * Unit vector towards the light, so the house's shadow falls the same way as every element's.
   * Omitted takes the conventional drawing light, which is what steps 1 and 2 want — they are
   * about the property, not about the sun.
   */
  light?: Point;
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

  // Null when the outline is too small for a wall this thick; the flat fill stands in.
  const interior = useMemo(() => insetPolygon(outline, WALL_THICKNESS), [outline]);

  // Away from the light, so the building stands on the garden rather than beside it.
  const shadow = useMemo(
    () => houseGroundShadow(outline, light ?? LIGHT_DIRECTION),
    [outline, light],
  );

  return (
    <Group>
      {/*
        Unconditional, unlike the cast-shadow layer, which only exists when the plan knows where on
        Earth it is. This is the contact-shadow convention: a fixed depth that says "this stands up
        out of the ground" rather than anything about the sun. It is also what replaces the job the
        oak floor texture used to do badly — see `drawHouse` in `render-plan.ts`.
      */}
      <Line
        points={polygonToKonvaPoints(shadow, transform)}
        closed
        fill={SHADOW_TONE}
        opacity={HOUSE_SHADOW_ALPHA}
        listening={false}
      />
      <Line
        data-testid="house-shape"
        points={polygonToKonvaPoints(outline, transform)}
        closed
        fill={interior ? COLOUR.houseWall : COLOUR.houseFill}
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

      {/*
        The inside of the building, deliberately plain — see `drawHouse`. It was tiled with a
        photograph of pale oak flooring, which read as a very large deck and made the house the
        brightest, most textured object in a drawing whose subject is the garden.
      */}
      {interior ? (
        <Line
          points={polygonToKonvaPoints(interior, transform)}
          closed
          fill={COLOUR.houseFill}
          listening={false}
        />
      ) : null}

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
