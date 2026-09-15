'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Leaf, Sparkles } from 'lucide-react';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { useAssistantStore } from '@/state/assistant-store';
import { chosenConcept, useConceptsStore } from '@/state/concepts-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { usePlanHref } from '../ProjectContext';
import { AddFeaturePalette } from './AddFeaturePalette';
import { AreaSummaryPanel } from './AreaSummaryPanel';
import { DesignAgentPanel } from './DesignAgentPanel';
import { EditorCanvasLoader } from './EditorCanvasLoader';
import { EditorToolbar } from './EditorToolbar';
import { VisualisePanel } from './VisualisePanel';
import { PlacedElementsList } from './PlacedElementsList';
import { SelectedElementPanel } from './SelectedElementPanel';

export function EditorScreen() {
  const planHref = usePlanHref();
  const concept = useConceptsStore(chosenConcept);
  const seededFrom = usePlanEditorStore((state) => state.seededFrom);
  const seedFrom = usePlanEditorStore((state) => state.seedFrom);
  const [sidebar, setSidebar] = useState<'add' | 'layers'>('add');
  const [view, setView] = useState<'plan' | 'visualise'>('plan');
  const [visualiseOpened, setVisualiseOpened] = useState(false);
  const changeView = (next: 'plan' | 'visualise') => {
    if (next === 'visualise') setVisualiseOpened(true);
    setView(next);
  };

  /*
   * Load the chosen concept, and reload it if the user goes back and chooses a different one.
   * Keyed on the concept's id rather than on mount, so returning from step 4 without changing
   * anything does not throw away the edits made here.
   */
  useEffect(() => {
    if (concept && seededFrom !== concept.id) seedFrom(concept);
  }, [concept, seededFrom, seedFrom]);

  const runActive = useAiRunStore(selectRunActive);
  const agentPhase = useAssistantStore((state) => state.phase);
  const aiActive = runActive || agentPhase !== 'idle';

  /*
   * A request outlives this screen only long enough to finish.
   *
   * Navigating away mid-redesign is somebody moving on, not somebody objecting — and because the
   * plan only ever holds finished operations, applying the rest is the same garden they would have
   * had by waiting ten more seconds. What must not happen is the gesture bracket staying open after
   * the component that could close it has gone, which would leave the next edit collapsed into it.
   * `abandon` also stops the tail: nothing new starts on a screen nobody is looking at.
   */
  useEffect(() => () => useAssistantStore.getState().abandon(), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-garden-line bg-white px-4 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-garden-ink">
          <Leaf aria-hidden className="h-6 w-6 text-garden-green" />
          <span className="hidden sm:inline">Garden Studio</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2 border-l border-garden-line pl-4 text-xs">
          <Link href="/projects" className="text-garden-muted hover:text-garden-green">Projects</Link>
          <span className="text-garden-line">/</span>
          <h1 data-testid="editor-concept-name" className="truncate font-medium text-garden-ink">{concept?.name ?? 'Garden editor'}</h1>
        </div>
        <nav aria-label="Design steps" className="ml-auto hidden h-14 items-stretch gap-5 text-xs lg:flex">
          {([['map', 'Map'], ['features', 'Features'], ['brief', 'Brief'], ['concepts', 'Concepts'], ['editor', 'Design'], ['review', 'Review']] as const).map(([step, label]) => (
            <Link key={step} href={planHref(step)} aria-current={step === 'editor' ? 'step' : undefined}
              className={`flex items-center border-b-2 px-1 ${step === 'editor' ? 'border-garden-forest font-medium text-garden-forest' : 'border-transparent text-garden-muted hover:text-garden-green'}`}>
              {label}
            </Link>
          ))}
        </nav>
        <Link href={planHref('concepts')} className="ml-auto shrink-0 text-xs text-garden-muted lg:hidden">Concepts</Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white lg:flex-row lg:overflow-hidden">
        <aside data-testid="editor-catalogue" className={view === 'visualise' ? 'hidden' : "border-b border-garden-line lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0 xl:w-64"}>
          <div
            className="flex border-b border-garden-line"
            role="tablist"
            aria-label="Garden catalogue and layers"
          >
            {(['add', 'layers'] as const).map((tab) => (
              <button
                key={tab}
                id={`sidebar-${tab}`}
                role="tab"
                aria-selected={sidebar === tab}
                aria-controls={`sidebar-panel-${tab}`}
                onClick={() => setSidebar(tab)}
                className={`flex-1 border-b-2 px-4 py-3 text-xs font-medium ${sidebar === tab ? 'border-garden-green text-garden-green' : 'border-transparent text-garden-muted'}`}
              >
                {tab === 'add' ? 'Add to garden' : 'Layers'}
              </button>
            ))}
          </div>
          <div
            id={`sidebar-panel-${sidebar}`}
            role="tabpanel"
            aria-labelledby={`sidebar-${sidebar}`}
            className="max-h-80 space-y-5 overflow-y-auto p-4 lg:max-h-none lg:flex-1"
          >
            {concept ? (
              sidebar === 'add' ? (
                <AddFeaturePalette />
              ) : (
                <>
                  <PlacedElementsList />
                  <AreaSummaryPanel />
                </>
              )
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-[540px] min-w-0 flex-1 flex-col gap-2 bg-slate-50 p-3 lg:min-h-0">
          {concept ? (
            <>
              <EditorToolbar view={view} setView={changeView} />
              <div className="min-h-[420px] flex-1 lg:min-h-0">
                {/*
                  Both mounted, one hidden. The canvas measures itself on mount and eases its zoom
                  to fit, so unmounting it on every tab switch would throw that away and re-fit —
                  and the user would lose wherever they had panned to. `hidden` keeps the stage
                  alive and its viewport where they left it.
                */}
                <div className={view === 'plan' ? 'h-full' : 'hidden'}>
                  <EditorCanvasLoader />
                </div>
                {visualiseOpened ? <div className={view === 'visualise' ? 'h-full' : 'hidden'}><VisualisePanel /></div> : null}
              </div>
            </>
          ) : (
            <NoConceptNotice />
          )}
        </main>

        {/*
          Wider than the other screens' right column, and wider than it was.

          `xl:w-72` fitted a properties panel and a chat squeezed underneath it; it does not fit a
          conversation you are meant to hold. At 320–384px a reply is a readable line rather than
          three words wide, and the canvas absorbs the loss because it fits itself to the plot.

          Two panes, not one scrolling column. A `flex-1 min-h-0` child inside `overflow-y-auto`
          collapses — the same trap step 2 already recorded — and the conversation then paints over
          the form underneath. The column clips; each pane scrolls inside itself.
        */}
        <aside data-testid="editor-inspector" className={view === 'visualise' ? 'hidden' : "flex flex-col gap-3 border-l border-garden-line bg-white p-3 lg:min-h-0 lg:w-80 lg:shrink-0 lg:overflow-hidden xl:w-96"}>
          {/*
            The designer above the properties panel, not below it.

            Properties grow with the selected element — a bed with edging and a retaining wall runs
            to most of a column — so anything under them is below the fold exactly when a run is in
            progress and has selected something. What is happening to the garden has to be readable
            without scrolling; which material the selected patio is can wait. Each pane now has its
            own scroll, so that still holds without the two overlapping.
          */}
          {concept ? <DesignAgentPanel /> : null}
          <SelectedElementPanel />
        </aside>
      </div>

      <PlanBottomBar
        backHref={planHref('concepts')}
        continueHref={planHref('review')}
        continueLabel="Preview design"
        /*
         * Continue flushes the autosave, and a flush in the middle of a run would upload a garden
         * half way through being redesigned. Blocked rather than made to wait, so the reason is on
         * screen instead of the button simply hanging.
         */
        blockedReason={
          concept
            ? aiActive
              ? 'Wait for the designer to finish, or stop it.'
              : null
            : 'Choose a concept on the previous step first.'
        }
      />
    </div>
  );
}

function NoConceptNotice() {
  const planHref = usePlanHref();

  return (
    <div
      data-testid="editor-no-concept"
      className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
        <Sparkles aria-hidden className="h-6 w-6 text-garden-green" />
      </span>
      <h2 className="text-sm font-semibold text-garden-forest">Choose a concept first</h2>
      <p className="max-w-sm text-xs leading-relaxed text-garden-muted">
        The editor works on the concept you picked on the previous step.
      </p>
      <Link
        href={planHref('concepts')}
        data-testid="editor-go-back"
        className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
      >
        Back to Design concepts
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
    </div>
  );
}
