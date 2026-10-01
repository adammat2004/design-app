'use client';

import { Circle, Group, Line, Rect } from 'react-konva';
import type { Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, rubberBandRect, type CanvasTransform } from '@/lib/canvas-transform';
import { formatLength, type Unit } from '@/lib/units';
import { CLOSE_DISTANCE } from '@/lib/draw-draft';
import { Label } from '../canvas-primitives';

/**
 * What is being drawn, before it is anything: the corners clicked so far, a ghost to where the next
 * one will land, and the rectangle being dragged out.
 *
 * The ghost's end is the store's own `previewDraftPoint`, so the preview cannot promise a position
 * the click then fails to deliver — the rule step 1's boundary has always followed. The first corner
 * grows a ring once the shape can close on it, at the real `CLOSE_DISTANCE`, so the target a user
 * aims at is the target the store tests.
 *
 * Fragments in the chrome layer, never a layer of their own: the stage's layer budget is four.
 */
export function DraftOverlay({
  points,
  ghost,
  closable,
  band,
  transform,
  unit,
}: {
  points: Point[];
  ghost: Point | null;
  closable: boolean;
  band: { start: Point; current: Point } | null;
  transform: CanvasTransform;
  unit: Unit;
}) {
  const path = ghost ? [...points, ghost] : points;
  const flat = path.flatMap((point) => {
    const at = metresToPx(point, transform);
    return [at.x, at.y];
  });
  const last = points.at(-1);
  const first = points[0];

  return (
    <Group listening={false}>
      {band ? (
        <Rect
          {...rubberBandRect(band, transform)}
          stroke={COLOUR.handle}
          strokeWidth={1.5}
          dash={[6, 4]}
          fill="rgba(47, 122, 62, 0.08)"
        />
      ) : null}

      {path.length > 1 ? (
        <Line points={flat} stroke={COLOUR.handle} strokeWidth={2} dash={[6, 4]} lineJoin="round" />
      ) : null}

      {closable && first ? (
        <Circle
          {...metresToPx(first, transform)}
          radius={Math.max(8, CLOSE_DISTANCE * transform.scale)}
          stroke={COLOUR.handle}
          strokeWidth={1.5}
          dash={[3, 3]}
        />
      ) : null}

      {points.map((point, index) => (
        <Circle
          key={index}
          {...metresToPx(point, transform)}
          radius={4}
          fill="#ffffff"
          stroke={COLOUR.handle}
          strokeWidth={1.5}
        />
      ))}

      {ghost && last ? (
        <Label
          at={metresToPx({ x: (last.x + ghost.x) / 2, y: (last.y + ghost.y) / 2 }, transform)}
          text={formatLength(Math.hypot(ghost.x - last.x, ghost.y - last.y), unit)}
          tone={COLOUR.handle}
        />
      ) : null}
    </Group>
  );
}
