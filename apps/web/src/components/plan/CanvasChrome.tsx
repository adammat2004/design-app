'use client';

import { Crosshair, Hand, Layers, Minus, Plus } from 'lucide-react';
import type { CanvasTransform } from '@/lib/canvas-transform';
import type { Unit } from '@/lib/units';
import { formatViewportSpan, viewportSpan } from '@/lib/grid';
import { CompassRose } from './CompassRose';
import { RenderHud } from './RenderHud';
import { ScaleBar, ZoomButton } from './canvas-primitives';

/** What the chrome shows about the aerial imagery, when there is any. */
export interface ImageryChrome {
  /** The provider's credit line — a condition of every imagery licence, so never optional. */
  attribution: string;
  visible: boolean;
  onToggle: () => void;
  /** Loaded and wanted tile counts, for the status line and for the e2e tests. */
  loaded: number;
  total: number;
  /** Metres across at which the imagery is drawn at its native sharpness, or null if unknown. */
  sharpestSpan: number | null;
}

/**
 * The furniture that sits on top of every plan canvas: which way is north, how long a metre is,
 * and the zoom stack. One component rather than a copy per screen, so the two never drift into
 * offering different controls in different corners.
 */
export function CanvasChrome({
  transform,
  unit,
  panning,
  imagery,
  onZoomIn,
  onZoomOut,
  onFit,
  onTogglePan,
}: {
  transform: CanvasTransform;
  unit: Unit;
  panning: boolean;
  imagery?: ImageryChrome | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onTogglePan: () => void;
}) {
  const span = viewportSpan(transform.stageWidth, transform.scale);

  return (
    <>
      <CompassRose />
      <ScaleBar transform={transform} unit={unit} />
      {/* Development only, and it renders nothing in a production build. See `RenderHud`. */}
      <RenderHud />

      {imagery ? (
        <p
          data-testid="imagery-status"
          data-visible={imagery.visible}
          data-loaded={imagery.loaded}
          data-total={imagery.total}
          className="pointer-events-auto absolute bottom-4 left-1/2 max-w-[60%] -translate-x-1/2 rounded-md bg-white/85 px-2 py-0.5 text-center text-[10px] leading-snug text-garden-muted"
        >
          {imagery.visible ? (
            <>
              {imagery.total > 0 && imagery.loaded < imagery.total
                ? 'Loading imagery… '
                : imagery.total === 0
                  ? 'Imagery unavailable here — you can still draw. '
                  : null}
              {imagery.sharpestSpan !== null && span < imagery.sharpestSpan ? (
                <span data-testid="imagery-sharpest">
                  Sharpest at about {Math.round(imagery.sharpestSpan)} m across.{' '}
                </span>
              ) : null}
              <span data-testid="imagery-attribution">{imagery.attribution}</span>
            </>
          ) : (
            'Aerial imagery hidden'
          )}
        </p>
      ) : null}

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
          {formatViewportSpan(span, unit)}
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
        {imagery ? (
          <ZoomButton
            label="Show aerial imagery"
            testId="imagery-toggle"
            pressed={imagery.visible}
            onClick={imagery.onToggle}
          >
            <Layers aria-hidden className="h-4 w-4" />
          </ZoomButton>
        ) : null}
      </div>
    </>
  );
}
