'use client';

import { Group, Layer } from 'react-konva';
import { elementAnchor, type Point } from '@garden-studio/schema';
import type { MotionEntry } from '@/lib/ai-run/evaluate';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { ElementDrawing } from '../ElementDrawing';

/**
 * The elements the AI is moving this instant, drawn above the settled plan.
 *
 * Why a separate layer rather than letting the real renderer draw the change frame by frame: one
 * scene build for this garden costs about 34 ms, nearly all of it re-sampling the planting in every
 * bed, and the Pixi compositor rebuilds its whole display list whenever the scene's content
 * fingerprint moves. Thirty of those a second is not a budget that exists. **Measured before it was
 * designed around** — see the Phase 0 note in CLAUDE.md.
 *
 * So the expensive renderer keeps drawing the last *settled* plan, which only changes at an
 * operation boundary, and the handful of things actually in flight are drawn here with the same
 * `ElementDrawing` the editor uses for everything — with `interacting` set, which is the cap the
 * technical renderer already applies to a shape being dragged. The visible consequence is that a
 * moving surface loses its finest texture for the second it is moving, which is exactly what
 * happens today when a person drags one.
 *
 * `scale` is applied to the Konva node, never to the geometry. An element popping in is a drawing
 * effect; scaling its `shape` would mean the plan briefly held a size nobody specified.
 */
export function MotionLayer({
  entries,
  transform,
  light,
}: {
  entries: MotionEntry[];
  transform: CanvasTransform;
  light?: Point;
}) {
  if (entries.length === 0) return null;

  return (
    <Layer listening={false}>
      {entries.map((entry) => {
        const anchor = metresToPx(elementAnchor(entry.element), transform);
        return (
          <Group
            key={entry.key}
            x={anchor.x}
            y={anchor.y}
            opacity={entry.opacity}
            scaleX={entry.scale}
            scaleY={entry.scale}
            listening={false}
          >
            <ElementDrawing
              element={entry.element}
              transform={transform}
              offsetPx={anchor}
              light={light}
              interacting
            />
          </Group>
        );
      })}
    </Layer>
  );
}
