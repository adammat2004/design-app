'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Leaf, Sparkles } from 'lucide-react';
import { chosenConcept, useConceptsStore } from '@/state/concepts-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { usePlanHref } from '../ProjectContext';
import { AddFeaturePalette } from './AddFeaturePalette';
import { AreaSummaryPanel } from './AreaSummaryPanel';
import { AssistantPanel } from './AssistantPanel';
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

  /*
   * Load the chosen concept, and reload it if the user goes back and chooses a different one.
   * Keyed on the concept's id rather than on mount, so returning from step 4 without changing
   * anything does not throw away the edits made here.
   */
  useEffect(() => {
    if (concept && seededFrom !== concept.id) seedFrom(concept);
  }, [concept, seededFrom, seedFrom]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-6 border-b border-garden-line bg-white px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-garden-ink">
          <Leaf aria-hidden className="h-6 w-6 text-garden-green" />
          Garden Studio
        </Link>
        <Link href="/" className="text-xs text-garden-muted hover:text-garden-green">
          Projects
        </Link>
      </header>
      <div className="flex shrink-0 items-center gap-5 border-b border-garden-line bg-white px-5 py-3">
        <Link
          href={planHref('concepts')}
          className="flex items-center gap-2 text-xs text-garden-muted"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back to concepts
        </Link>
        <div className="min-w-0 border-l border-garden-line pl-5">
          <div className="flex items-center gap-3">
            <h1
              data-testid="editor-concept-name"
              className="truncate text-lg font-semibold text-garden-ink"
            >
              {concept?.name ?? 'Garden editor'}
            </h1>
            <span className="rounded bg-garden-sage px-2 py-1 text-[11px] text-garden-green">
              Editing
            </span>
          </div>
          <p className="text-xs text-garden-muted">Shape your garden, one detail at a time.</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white lg:flex-row lg:overflow-hidden">
        <aside className="border-b border-garden-line lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0 xl:w-72">
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
              <EditorToolbar view={view} setView={setView} />
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
                {view === 'visualise' ? <VisualisePanel /> : null}
              </div>
            </>
          ) : (
            <NoConceptNotice />
          )}
        </main>

        {/*
          Wider than the other screens' right column. `xl:w-64` fits a properties panel; it does
          not fit a conversation, and squeezing the chat into it would make every message three
          words wide.
        */}
        <aside className="flex flex-col gap-4 border-l border-garden-line bg-white p-3 lg:min-h-0 lg:w-72 lg:shrink-0 lg:overflow-y-auto xl:w-80">
          <SelectedElementPanel />
          {concept ? <AssistantPanel /> : null}
        </aside>
      </div>

      <PlanBottomBar
        backHref={planHref('concepts')}
        continueHref={planHref('review')}
        continueLabel="Preview design"

        blockedReason={concept ? null : 'Choose a concept on the previous step first.'}
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
