'use client';

import { useEffect, useState } from 'react';
import { boundingBox, lightDirection, type Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { fitTransform, metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementOutline, type DesignElement, type GeneratedConcept } from '@/lib/concepts';
import { housePolygon, type HouseFootprint } from '@/lib/house';
import { getAssetVariants } from '@/lib/materials/assets/registry';
import { useAssetVersion } from '@/lib/materials/assets/use-assets';
import { drawPlan, type PlanContext } from '@/lib/materials/render-plan';
import type { MakeCanvas, PatternCanvas } from '@/lib/materials/render-surface-pattern';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * A concept at card size.
 *
 * Two layers. The inline SVG is what renders on the server and under jsdom, for the reason
 * `brief/PropertyThumbnail.tsx` gives: Konva has to come through `dynamic(..., { ssr: false })`,
 * which would mean four loading skeletons pulsing in the sidebar for pictures nobody clicks. It
 * projects through the same `fitTransform` / `metresToPx` the real canvas uses and reads the same
 * `elements` array in the same order.
 *
 * Over it, once the browser has a 2D context, sits the real thing: the concept drawn by `drawPlan`
 * — the composer the editor's export and the judging sheets use — so the card shows the textures,
 * the sprites and the furniture the next screen will. The card used to show flat category colour
 * while the canvas showed a garden, and choosing between three designs from a drawing that
 * contradicts what you get is the one place that divergence really costs something.
 */

/** The raster is drawn at twice the card's box so it stays crisp on a dense display. */
const RASTER = { width: 480, height: 264, padding: 12 };

const makeBrowserCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

/**
 * The concept as a data URL, drawn on the client after mount. `null` on the server, before the
 * effect runs, and when there is nothing to draw — the SVG shows through in all three cases.
 */
function useConceptRaster(
  concept: GeneratedConcept | null,
  boundary: Point[],
  house: HouseFootprint | null,
): string | null {
  const site = useBoundaryStore((state) => state.present);
  const assetVersion = useAssetVersion();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    /*
     * Drawn on the next frame rather than inside the effect itself: three cards drawing three
     * gardens synchronously in one commit would hold the step-4 screen for the whole of it, and
     * a frame later nobody notices. It also keeps the state write out of the effect body.
     */
    const frame = requestAnimationFrame(() => {
      setUrl(drawConceptRaster(concept, boundary, house, site));
    });

    return () => cancelAnimationFrame(frame);
    // The version is what changes the textures; the concept's elements are what change the plan.
  }, [concept, boundary, house, site, assetVersion]);

  return url;
}

function drawConceptRaster(
  concept: GeneratedConcept | null,
  boundary: Point[],
  house: HouseFootprint | null,
  site: Parameters<typeof lightDirection>[0],
): string | null {
  if (!concept || boundary.length < 3 || typeof document === 'undefined') return null;

  const box = boundingBox(boundary);
  const inner = { w: RASTER.width - RASTER.padding * 2, h: RASTER.height - RASTER.padding * 2 };
  const pxPerMetre = Math.min(inner.w / box.width, inner.h / box.length);
  if (!Number.isFinite(pxPerMetre) || pxPerMetre <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = RASTER.width;
  canvas.height = RASTER.height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  // Centred in the card, on the same paper the canvases sit on.
  const offsetX = (RASTER.width - box.width * pxPerMetre) / 2 / pxPerMetre;
  const offsetY = (RASTER.height - box.length * pxPerMetre) / 2 / pxPerMetre;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, RASTER.width, RASTER.height);

  drawPlan(
    context as unknown as PlanContext,
    { boundary, house, elements: concept.elements, site },
    {
      pxPerMetre,
      light: lightDirection(site) ?? undefined,
      makeCanvas: makeBrowserCanvas,
      assets: getAssetVariants,
    },
    { x: box.minX - offsetX, y: box.minY - offsetY },
  );

  return canvas.toDataURL('image/png');
}

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
  const raster = useConceptRaster(concept, boundary, house);

  if (!plan) {
    return (
      <span
        data-testid="concept-thumbnail-empty"
        aria-hidden
        className="block h-20 w-full rounded-lg border border-dashed border-garden-line bg-garden-canvas"
      />
    );
  }

  if (raster) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn moments ago, not an asset to optimise
      <img
        data-testid={`concept-thumbnail-${concept?.id ?? 'empty'}`}
        src={raster}
        alt={concept ? `Plan view of ${concept.name}` : 'Empty plan'}
        width={RASTER.width}
        height={RASTER.height}
        className="h-auto w-full rounded-lg border border-garden-line bg-white"
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
