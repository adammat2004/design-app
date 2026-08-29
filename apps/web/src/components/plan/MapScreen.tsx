'use client';

import { Map } from 'lucide-react';
import { useBoundaryStore } from '@/state/boundary-store';
import { BoundaryCanvasLoader } from './BoundaryCanvasLoader';
import { BoundaryToolsPanel } from './BoundaryToolsPanel';
import { CanvasToolbar } from './CanvasToolbar';
import { DesignAreasPanel } from './DesignAreasPanel';
import { HouseToolsPanel } from './HouseToolsPanel';
import { LegendPanel } from './LegendPanel';
import { MeasuredCornerPanel } from './MeasuredCornerPanel';
import { PlanBottomBar } from './PlanBottomBar';
import { usePlanHref } from './ProjectContext';
import { PlanTopBar } from './PlanTopBar';
import { PlotSanityCallout } from './PlotSanityCallout';
import { PlotShapePanel } from './PlotShapePanel';
import { PropertySummary } from './PropertySummary';
import { SelectedObjectPanel } from './SelectedObjectPanel';
import { SideLengthsPanel } from './SideLengthsPanel';
import { SubStepChecklist } from './SubStepChecklist';
import { TipCallout } from './TipCallout';

export function MapScreen() {
  const planHref = usePlanHref();
  const mode = useBoundaryStore((state) => state.mode);
  const draft = useBoundaryStore((state) => state.present);

  // Step 2 places features in the garden, which needs both an enclosed plot and a house to
  // work the garden areas out from.
  const blockedReason = !draft.closed
    ? 'Close the property boundary before continuing.'
    : !draft.house
      ? 'Place your house inside the property before continuing.'
      : draft.selectedZoneIds.length === 0
        ? 'Choose at least one area to design before continuing.'
        : null;

  return (
    /*
     * One viewport tall, not one page tall. The canvas anchors its compass, scale bar and zoom
     * stack to its own bottom edge, so a canvas taller than the window puts all of that below
     * the fold — and makes the fit-on-load frame into a box the user can only partly see. The
     * side columns scroll inside themselves instead. Below xl the columns stack and the page
     * scrolls normally again.
     */
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlanTopBar currentStep={1} />

      {/*
        Canvas-centric three-column layout. The side columns are fixed-width so the canvas
        takes every pixel left over; below xl they stack above and below it instead.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-5 xl:overflow-hidden xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Map aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Mapping setup</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                First outline your property boundary, then place your house footprint so we can work
                out the usable garden space.
              </p>
            </div>
          </div>

          {/* Ahead of the checklist: a plot drawn at the wrong scale makes every later step wrong. */}
          <PlotSanityCallout />

          <SubStepChecklist />

          {/* The tools follow whichever sub-step is in hand. */}
          {mode === 'house' ? (
            <HouseToolsPanel />
          ) : (
            <>
              {/* The shape picker, or the dimension fields once the outline matches a preset. */}
              <PlotShapePanel />
              <MeasuredCornerPanel />
              <SideLengthsPanel />
              <BoundaryToolsPanel />
            </>
          )}

          <PropertySummary />
          <TipCallout />
        </aside>

        <main className="flex min-h-[480px] min-w-0 flex-1 flex-col gap-3 xl:min-h-0">
          <CanvasToolbar />
          <div className="min-h-[420px] flex-1 xl:min-h-0">
            <BoundaryCanvasLoader />
          </div>
        </main>

        <aside className="space-y-4 xl:min-h-0 xl:w-64 xl:shrink-0 xl:overflow-y-auto">
          <DesignAreasPanel />
          <SelectedObjectPanel />
          <LegendPanel />
        </aside>
      </div>

      <PlanBottomBar continueHref={planHref('features')} blockedReason={blockedReason} />
    </div>
  );
}
