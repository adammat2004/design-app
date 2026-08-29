'use client';

import { boundingBox } from '@/lib/boundary-geometry';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementOutline, type DesignElement } from '@/lib/concepts';
import { materialFill } from '@/lib/materials';

/**
 * One element on its own, at chip size, for the Selected feature panel.
 *
 * Inline SVG rather than Konva for the reason `PropertyThumbnail.tsx` gives: Konva has to come
 * through `dynamic(..., { ssr: false })`, which would put a loading skeleton in a 48-pixel box.
 * SVG renders on the server, needs no loader, and works under jsdom.
 *
 * It frames the element's own bounding box rather than the garden's, so a 1 m water bowl and a
 * 20 m lawn both fill the chip — this is a picture of the shape, not of where it sits.
 */

const VIEW = 48;
const PAD = 4;

/** Pure, and exported so the projection can be tested without mounting anything. */
export function elementThumbnailGeometry(element: DesignElement) {
  const outline = elementOutline(element);
  if (outline.length < 3) return null;

  const box = boundingBox(outline);
  const span = Math.max(box.width, box.length);
  if (span <= 0) return null;

  const scale = (VIEW - PAD * 2) / span;
  // Centre whichever axis has slack, so a long thin path sits in the middle rather than the top.
  const offsetX = PAD + (VIEW - PAD * 2 - box.width * scale) / 2;
  const offsetY = PAD + (VIEW - PAD * 2 - box.length * scale) / 2;

  return {
    points: outline
      .map((point) => {
        const x = (point.x - box.minX) * scale + offsetX;
        const y = (point.y - box.minY) * scale + offsetY;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' '),
    fill: materialFill(element),
    stroke: CATEGORY_COLOURS[element.category].stroke,
  };
}

export function ElementThumbnail({ element }: { element: DesignElement }) {
  const plan = elementThumbnailGeometry(element);

  if (!plan) {
    return (
      <span
        data-testid="element-thumbnail-empty"
        aria-hidden
        style={{ background: materialFill(element) }}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-garden-line"
      />
    );
  }

  return (
    <svg
      data-testid="element-thumbnail"
      role="img"
      aria-label={`Shape of ${element.name ?? CATEGORY_COLOURS[element.category].label}`}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className="h-12 w-12 shrink-0 rounded-lg border border-garden-line bg-garden-canvas"
    >
      <polygon
        points={plan.points}
        fill={plan.fill}
        stroke={plan.stroke}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
