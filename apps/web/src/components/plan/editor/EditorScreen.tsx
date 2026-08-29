'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, PenLine, Sparkles } from 'lucide-react';
import { chosenConcept, useConceptsStore } from '@/state/concepts-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { AddFeaturePalette } from './AddFeaturePalette';
import { AreaSummaryPanel } from './AreaSummaryPanel';
import { AssistantPanel } from './AssistantPanel';
import { ConceptSummaryCard } from './ConceptSummaryCard';
import { EditorCanvasLoader } from './EditorCanvasLoader';
import { EditorToolbar } from './EditorToolbar';
import { PlacedElementsList } from './PlacedElementsList';
import { SelectedElementPanel } from './SelectedElementPanel';

export function EditorScreen() {
  const planHref = usePlanHref();
  const concept = useConceptsStore(chosenConcept);
  const seededFrom = usePlanEditorStore((state) => state.seededFrom);
  const seedFrom = usePlanEditorStore((state) => state.seedFrom);

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
      <PlanTopBar currentStep={5} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-5 xl:overflow-hidden xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <PenLine aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Editor</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                Refine your concept by hand, or ask the assistant to change it for you.
              </p>
            </div>
          </div>

          {concept ? (
            <>
              <ConceptSummaryCard concept={concept} />
              <AddFeaturePalette />
              <PlacedElementsList />
              <AreaSummaryPanel />
            </>
          ) : null}
        </aside>

        <main className="flex min-h-[480px] min-w-0 flex-1 flex-col gap-3 xl:min-h-0">
          {concept ? (
            <>
              <EditorToolbar />
              <div className="min-h-[420px] flex-1 xl:min-h-0">
                <EditorCanvasLoader />
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
        <aside className="flex flex-col gap-4 xl:min-h-0 xl:w-80 xl:shrink-0 xl:overflow-y-auto">
          <SelectedElementPanel />
          {concept ? <AssistantPanel /> : null}
        </aside>
      </div>

      <PlanBottomBar
        backHref={planHref('concepts')}
        continueHref={planHref('review')}
        continueLabel="Continue to review"
        caption="Your edits carry through to the review."
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
