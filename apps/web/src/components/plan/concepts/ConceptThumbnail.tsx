'use client';

import type { Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { fitTransform, metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementOutline, type DesignElement, type GeneratedConcept } from '@/lib/concepts';
import { housePolygon, type HouseFootprint } from '@/lib/house';

/**
 * A concept at card size.
 *
 * Inline SVG rather than Konva, for the reason `brief/PropertyThumbnail.tsx` gives: Konva has
 * to come through `dynamic(..., { ssr: false })`, which would mean four loading skeletons
 * pulsing in the sidebar for pictures nobody clicks. SVG renders on the server, needs no
 * loader, and works under jsdom.
 *
 * It projects through the same `fitTransform` / `metresToPx` the real canvas uses and reads
 * the same `elements` array in the same order, so a card can never show a different garden
 * from the one the canvas draws when you click it.
 */

/** Fixed viewBox units; CSS scales the finished picture to whatever the card is wide. */
const VIEW = { width: 240, height: 132, padding: 8 };

interface ThumbnailShape {
  id: string;
  kind: 'polygon' | 'circle' | 'line';
  points?: string;
  centre?: Point;
  radius?: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * The pixel geometry the SVG draws, or null before there is a property to draw it on.
 *
 * Pure and exported so the projection can be tested without mounting anything — the same trick
 * `PropertyThumbnail.test.ts` uses.
 */
export function conceptThumbnailGeometry(
  concept: GeneratedConcept | null,
  boundary: Point[],
  house: HouseFootprint | null,
) {
  if (boundary.length < 3) return null;

  const transform = fitTransform(boundary, VIEW);

  return {
    outline: project(boundary, transform),
    house: house ? project(housePolygon(house), transform) : null,
    // Emission order is render order — fills under features, exactly as on the canvas.
    shapes: (concept?.elements ?? []).map((element) => toShape(element, transform)),
  };
}

function project(ring: Point[], transform: CanvasTransform): string {
  return ring
    .map((point) => {
      const at = metresToPx(point, transform);
      return `${at.x.toFixed(1)},${at.y.toFixed(1)}`;
    })
    .join(' ');
}

function toShape(element: DesignElement, transform: CanvasTransform): ThumbnailShape {
  const style = CATEGORY_COLOURS[element.category];
  const isFill = element.role === 'fill';

  if (element.shape.kind === 'point') {
    return {
      id: element.id,
      kind: 'circle',
      centre: metresToPx(element.shape.at, transform),
      radius: Math.max(1.5, element.shape.radius * transform.scale),
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: 0.5,
    };
  }

  if (element.shape.kind === 'polyline') {
    return {
      id: element.id,
      kind: 'line',
      points: project(element.shape.points, transform),
      fill: 'none',
      stroke: style.fill,
      strokeWidth: Math.max(1.5, element.shape.width * transform.scale),
    };
  }

  return {
    id: element.id,
    kind: 'polygon',
    points: project(elementOutline(element), transform),
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: isFill ? 0.4 : 0.8,
  };
}

export function ConceptThumbnail({
  concept,
  boundary,
  house,
}: {
  concept: GeneratedConcept | null;
  boundary: Point[];
  house: HouseFootprint | null;
}) {
  const plan = conceptThumbnailGeometry(concept, boundary, house);

  if (!plan) {
    return (
      <span
        data-testid="concept-thumbnail-empty"
        aria-hidden
        className="block h-20 w-full rounded-lg border border-dashed border-garden-line bg-garden-canvas"
      />
    );
  }

  return (
    <svg
      data-testid={`concept-thumbnail-${concept?.id ?? 'empty'}`}
      role="img"
      aria-label={concept ? `Plan view of ${concept.name}` : 'Empty plan'}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className="h-auto w-full rounded-lg border border-garden-line bg-white"
    >
      <polygon points={plan.outline} fill={COLOUR.fill} stroke="none" />

      {plan.shapes.map((shape) =>
        shape.kind === 'circle' ? (
          <circle
            key={shape.id}
            cx={shape.centre?.x}
            cy={shape.centre?.y}
            r={shape.radius}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
          />
        ) : shape.kind === 'line' ? (
          <polyline
            key={shape.id}
            points={shape.points}
            fill="none"
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <polygon
            key={shape.id}
            points={shape.points}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinejoin="round"
          />
        ),
      )}

      {plan.house ? (
        <polygon
          points={plan.house}
          fill={COLOUR.houseFill}
          stroke={COLOUR.houseStroke}
          strokeWidth={0.8}
        />
      ) : null}

      <polygon
        points={plan.outline}
        fill="none"
        stroke={COLOUR.stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
