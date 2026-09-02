'use client';

import { Crosshair, Hand, Minus, Plus } from 'lucide-react';
import type { CanvasTransform } from '@/lib/canvas-transform';
import type { Unit } from '@/lib/units';
import { formatViewportSpan, viewportSpan } from '@/lib/grid';
import { CompassRose } from './CompassRose';
import { RenderHud } from './RenderHud';
import { ScaleBar, ZoomButton } from './canvas-primitives';

/**
 * The furniture that sits on top of every plan canvas: which way is north, how long a metre is,
 * and the zoom stack. One component rather than a copy per screen, so the two never drift into
 * offering different controls in different corners.
 */
export function CanvasChrome({
  transform,
  unit,
  panning,
  onZoomIn,
  onZoomOut,
  onFit,
  onTogglePan,
}: {
  transform: CanvasTransform;
  unit: Unit;
  panning: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onTogglePan: () => void;
}) {
  return (
    <>
      <CompassRose />
      <ScaleBar transform={transform} unit={unit} />
      {/* Development only, and it renders nothing in a production build. See `RenderHud`. */}
      <RenderHud />

      <div className="pointer-events-auto absolute right-4 bottom-4 flex flex-col overflow-hidden rounded-lg border border-garden-line bg-white shadow-sm">
        <ZoomButton label="Zoom in" testId="zoom-in" onClick={onZoomIn}>
          <Plus aria-hidden className="h-4 w-4" />
        </ZoomButton>
        {/*
          What the view spans, not what percentage it is at. See `viewportSpan` — a percentage on
          a plan is a number with no referent, and this is the reading the user can check against
          a garden they know.
        */}
        <span
          data-testid="zoom-level"
          title="How much ground fits across the view"
          className="border-b border-garden-line px-2 py-1 text-center text-[11px] font-medium whitespace-nowrap text-garden-ink"
        >
          {formatViewportSpan(viewportSpan(transform.stageWidth, transform.scale), unit)}
        </span>
        <ZoomButton label="Zoom out" testId="zoom-out" onClick={onZoomOut}>
          <Minus aria-hidden className="h-4 w-4" />
        </ZoomButton>
        <ZoomButton label="Fit the plan to the view" testId="zoom-fit" onClick={onFit}>
          <Crosshair aria-hidden className="h-4 w-4" />
        </ZoomButton>
        <ZoomButton
          label="Pan the view"
          testId="pan-toggle"
          pressed={panning}
          onClick={onTogglePan}
        >
          <Hand aria-hidden className="h-4 w-4" />
        </ZoomButton>
      </div>
    </>
  );
}
