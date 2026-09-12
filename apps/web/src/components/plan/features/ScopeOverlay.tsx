'use client';

import { Line, Shape } from 'react-konva';
import type { GardenZone, Point } from '@garden-studio/schema';
import { metresToPx, polygonToKonvaPoints, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * What the concept generator is allowed to change, drawn on the plan.
 *
 * Two shapes of answer, and they need two different drawings:
 *
 * - **Zones.** Dim each zone that is *not* in scope. No new geometry at all — these are the same
 *   polygons the canvas already tints, so a zone cannot be dimmed in a place it is not drawn.
 * - **A custom area.** Dim the plot *except* the drawn outline, which is a polygon with a hole.
 *   Konva's `Line` cannot express one, so this is a `Shape` with a `sceneFunc` drawing both rings
 *   into one path and filling `'evenodd'` — the whole reason this component is not two `Line`s.
 *
 * It is spliced in above the zone tints and below the features, which is deliberate: the brief asks
 * for the house and the existing features to stay legible, and in this canvas both are drawn in
 * later layers. So they sit above the dim without needing to be excluded from it.
 */

/** Light enough to read the drawing underneath — this says "not this part", not "hidden". */
const DIM = 'rgba(15, 23, 42, 0.28)';

const ACCENT = 'var(--color-garden-green)';

export function ScopeOverlay({
  zones,
  selectedZoneIds,
  boundary,
  scopePolygon,
  transform,
}: {
  zones: GardenZone[];
  selectedZoneIds: string[];
  boundary: Point[];
  /** The custom outline, or null when the scope is whole zones. */
  scopePolygon: Point[] | null;
  transform: CanvasTransform;
}) {
  if (scopePolygon && scopePolygon.length >= 3 && boundary.length >= 3) {
    return (
      <>
        <Shape
          listening={false}
          sceneFunc={(context, shape) => {
            context.beginPath();

            for (const [index, point] of boundary.entries()) {
              const { x, y } = metresToPx(point, transform);
              if (index === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            }
            context.closePath();

            for (const [index, point] of scopePolygon.entries()) {
              const { x, y } = metresToPx(point, transform);
              if (index === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            }
            context.closePath();

            /*
             * `fillStrokeShape` would use Konva's own even-odd-less fill, so the hole is punched
             * here instead. The context is the real 2D one, so the fill rule is available.
             */
            context.fillStyle = DIM;
            (context as unknown as CanvasRenderingContext2D).fill('evenodd');
            context.fillStrokeShape(shape);
          }}
        />
        <Line
          listening={false}
          points={polygonToKonvaPoints(scopePolygon, transform)}
          closed
          stroke={ACCENT}
          strokeWidth={2}
          dash={[8, 5]}
        />
      </>
    );
  }

  // Zone scope: dim the ones left out. Nothing is drawn when every zone is in.
  return (
    <>
      {zones
        .filter((zone) => !selectedZoneIds.includes(zone.id))
        .map((zone) => (
          <Line
            key={zone.id}
            listening={false}
            points={polygonToKonvaPoints(zone.polygon, transform)}
            closed
            fill={DIM}
          />
        ))}
    </>
  );
}
