'use client';

import Link from 'next/link';
import { ArrowRight, Map, Shapes } from 'lucide-react';
import { useBoundaryStore } from '@/state/boundary-store';
import { DesignAreasPanel } from '../DesignAreasPanel';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { FeatureLegendPanel } from './FeatureLegendPanel';
import { FeatureTypePalette } from './FeatureTypePalette';
import { FeaturesCanvasLoader } from './FeaturesCanvasLoader';
import { FeaturesSubStep } from './FeaturesSubStep';
import { FeaturesTipCallout } from './FeaturesTipCallout';
import { FeaturesToolbar } from './FeaturesToolbar';
import { HowThisWorksCallout } from './HowThisWorksCallout';
import { PlacedFeatureList } from './PlacedFeatureList';
import { SelectedFeaturePanel } from './SelectedFeaturePanel';

export function FeaturesScreen() {
  const planHref = usePlanHref();
  const boundaryDraft = useBoundaryStore((state) => state.present);

  // Nothing here works without the property from step 1, so a plan that has not got that far
  // lands on the prompt to go back rather than on an empty grid.
  const hasProperty = boundaryDraft.closed && boundaryDraft.house !== null;

  return (
    /*
     * One viewport tall, not one page tall. The canvas anchors its compass, scale bar and zoom
     * stack to its own bottom edge, so a canvas taller than the window puts all of that below
     * the fold — and makes the fit-on-load frame into a box the user can only partly see. The
     * side columns scroll inside themselves instead. Below xl the columns stack and the page
     * scrolls normally again.
     */
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlanTopBar currentStep={2} />

      {/* Same three-column layout as step 1: fixed side columns, canvas takes the rest. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-5 xl:overflow-hidden xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Shapes aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Existing features</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                Map what is already on the property, then say whether each one stays, goes, or gets
                replaced.
              </p>
            </div>
          </div>

          <FeaturesSubStep />
          <FeatureTypePalette />
          <PlacedFeatureList />
          <FeaturesTipCallout />
        </aside>

        <main className="flex min-h-[480px] min-w-0 flex-1 flex-col gap-3 xl:min-h-0">
          {hasProperty ? (
            <>
              <FeaturesToolbar />
              <div className="min-h-[420px] flex-1 xl:min-h-0">
                <FeaturesCanvasLoader />
              </div>
            </>
          ) : (
            <MissingPropertyNotice />
          )}
        </main>

        <aside className="space-y-4 xl:min-h-0 xl:w-64 xl:shrink-0 xl:overflow-y-auto">
          <HowThisWorksCallout />
          <DesignAreasPanel />
          <SelectedFeaturePanel />
          <FeatureLegendPanel />
        </aside>
      </div>

      {/* An empty garden is a valid answer, so nothing here blocks Continue. */}
      <PlanBottomBar continueHref={planHref('brief')} />
    </div>
  );
}

function MissingPropertyNotice() {
  const planHref = usePlanHref();

  return (
    <div
      data-testid="missing-property"
      className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
        <Map aria-hidden className="h-6 w-6 text-garden-green" />
      </span>
      <h2 className="text-sm font-semibold text-garden-forest">Map your outdoor space first</h2>
      <p className="max-w-sm text-xs leading-relaxed text-garden-muted">
        Existing features are placed on top of your boundary and house, so step 1 needs to be
        finished before this one.
      </p>
      <Link
        href={planHref('map')}
        data-testid="back-to-map"
        className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
      >
        Back to Map dimensions
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
    </div>
  );
}
