'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Map, Shapes } from 'lucide-react';
import { useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';
import { useGardenAssistantStore } from '@/state/garden-assistant-store';
import { flushAll } from '@/state/project-sync';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { FeatureLegendPanel } from './FeatureLegendPanel';
import { FeaturesCanvasLoader } from './FeaturesCanvasLoader';
import { FeaturesTipCallout } from './FeaturesTipCallout';
import { FeaturesToolbar } from './FeaturesToolbar';
import { GardenAssistantPanel } from './GardenAssistantPanel';
import { PlacedFeatureList } from './PlacedFeatureList';
import { QuickAddPalette } from './QuickAddPalette';
import { RedesignAreaPanel } from './RedesignAreaPanel';
import { SelectedFeaturePanel } from './SelectedFeaturePanel';
import { WaysToAdd } from './WaysToAdd';

type Tab = 'features' | 'area';

/**
 * Step 2 — the existing garden.
 *
 * Three behaviours have to be equally first-class on this one screen: map the few things that
 * matter, describe the garden and have them mapped for you, or map nothing at all. The layout is
 * arranged around that rather than around the old "record your garden" framing — the canvas stays
 * the subject, the left column is the two ways in, and Skip is a real button in the bottom bar
 * rather than a checkbox in a list.
 *
 * The guiding line, and the reason the copy changed: **only map what matters.** The generator reads
 * existing features in exactly one place, and only to design around the ones marked Keep.
 */
export function FeaturesScreen() {
  const planHref = usePlanHref();
  const router = useRouter();
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const setSkipped = useFeaturesStore((state) => state.setSkipped);
  const assistantOpen = useGardenAssistantStore((state) => state.open);
  const setAssistantOpen = useGardenAssistantStore((state) => state.setOpen);

  const [tab, setTab] = useState<Tab>('features');

  // Nothing here works without the property from step 1, so a plan that has not got that far
  // lands on the prompt to go back rather than on an empty grid.
  const hasProperty = boundaryDraft.closed && boundaryDraft.house !== null;

  /**
   * Skipping is a real answer, not an escape hatch.
   *
   * It records the intent and moves on. Deliberately it does **not** clear what is already on the
   * plan: a feature the user drew is a fact about their garden whatever they then press, and
   * deleting it here would lose work to a button labelled "skip".
   */
  async function skip() {
    setSkipped(true);
    await flushAll();
    router.push(planHref('brief'));
  }

  /**
   * What the "Describe your garden" card does.
   *
   * Below xl it opens the drawer. On xl the panel is already there, so opening it would do nothing
   * visible — it focuses the input instead, which is the thing the user was reaching for.
   */
  function openAssistant() {
    setAssistantOpen(true);
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('[data-testid="garden-assistant-input"]')?.focus();
    });
  }

  return (
    /*
     * One viewport tall, not one page tall — same reasoning as step 1. The canvas anchors its
     * compass, scale bar and zoom stack to its own bottom edge, so a canvas taller than the window
     * puts all of that below the fold. The side columns scroll inside themselves instead. Below xl
     * the columns stack and the page scrolls normally again.
     */
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlanTopBar currentStep={2} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-5 xl:overflow-hidden xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Shapes aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Existing garden</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                Add anything the design needs to work around.
              </p>
            </div>
          </div>

          <p className="rounded-lg bg-garden-sage/50 px-2.5 py-2 text-[11px] leading-relaxed text-garden-muted">
            You don&rsquo;t need to map everything — just the key features you want to keep. You can
            also skip this step.
          </p>

          <div role="tablist" aria-label="Existing garden tools" className="flex gap-1">
            <TabButton id="features" active={tab} onSelect={setTab} label="Add features" />
            <TabButton id="area" active={tab} onSelect={setTab} label="Redesign area" />
          </div>

          {tab === 'features' ? (
            <div role="tabpanel" aria-label="Add features" className="space-y-4">
              <QuickAddPalette />
              <WaysToAdd onDescribe={openAssistant} />
              <PlacedFeatureList />
              <FeaturesTipCallout />
            </div>
          ) : (
            <div role="tabpanel" aria-label="Redesign area">
              <RedesignAreaPanel />
            </div>
          )}
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

          {/*
            Below xl the assistant is a sheet under the canvas rather than a third column, and it
            stays shut until asked for. The brief's rule, kept literally: the canvas must never be
            squeezed into an unusable strip, and manual editing must work without ever opening this.
          */}
          {assistantOpen ? (
            <div className="xl:hidden">
              <GardenAssistantPanel onClose={() => setAssistantOpen(false)} />
            </div>
          ) : null}
        </main>

        {/*
          Scrolls inside itself on xl, so the panels below the fold are reachable without the page
          scrolling under a canvas that is anchored to the viewport.
        */}
        <aside className="flex flex-col gap-4 xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <SelectedFeaturePanel />

          {/*
            Always on, on a wide screen — it is the second way into this step and hiding it behind a
            button made it a thing you had to already know about. There is no close on this copy:
            closing it on desktop would leave an empty column and a button to get it back.

            `block`, not `flex`: the panel is `flex-1` inside itself, and a flex child with
            `min-h-0` inside this scrolling column collapses to nothing — which is exactly what it
            did, leaving a heading with the conversation spilling over the legend beneath it. Given
            its natural height it sizes to its own content, and its log caps itself.
          */}
          <div className="hidden xl:block">
            <GardenAssistantPanel />
          </div>

          <FeatureLegendPanel />
        </aside>
      </div>

      {/* An empty garden is a valid answer, so nothing here blocks Continue. */}
      <PlanBottomBar
        continueHref={planHref('brief')}
        secondaryAction={{
          label: 'Skip this step',
          hint: 'I don’t need to map anything existing.',
          onClick: skip,
        }}
      />
    </div>
  );
}

function TabButton({
  id,
  active,
  onSelect,
  label,
}: {
  id: Tab;
  active: Tab;
  onSelect: (tab: Tab) => void;
  label: string;
}) {
  const selected = active === id;

  return (
    <button
      type="button"
      role="tab"
      data-testid={`tab-${id}`}
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={[
        'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        selected
          ? 'bg-garden-forest text-white'
          : 'bg-garden-sage/50 text-garden-ink hover:bg-garden-sage',
      ].join(' ')}
    >
      {label}
    </button>
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
