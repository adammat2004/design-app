'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleAlert, Map, Sparkles } from 'lucide-react';
import { briefCompletion } from '@/lib/brief';
import { useBoundaryStore } from '@/state/boundary-store';
import { useBriefStore } from '@/state/brief-store';
import { chosenConcept, selectedConcept, useConceptsStore } from '@/state/concepts-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { CompareView } from './CompareView';
import { ConceptCanvasLoader } from './ConceptCanvasLoader';
import { ConceptDetailsPanel } from './ConceptDetailsPanel';
import { ConceptLegendPanel } from './ConceptLegendPanel';
import { ConceptList } from './ConceptList';
import { ConceptsToolbar } from './ConceptsToolbar';
import { ProjectBriefPanel } from './ProjectBriefPanel';

export function ConceptsScreen() {
  const planHref = usePlanHref();
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const brief = useBriefStore((state) => state.present);

  const concepts = useConceptsStore((state) => state.present.concepts);
  const generating = useConceptsStore((state) => state.generating);
  const generateError = useConceptsStore((state) => state.generateError);
  const compareOpen = useConceptsStore((state) => state.compareOpen);
  const generateAll = useConceptsStore((state) => state.generateAll);
  const concept = useConceptsStore(selectedConcept);
  /*
   * The derived read, not the raw `chosenConceptId`. A regeneration can retire the concept the
   * user committed to, and Continue must not advance to a plan that is no longer on offer.
   */
  const chosen = useConceptsStore(chosenConcept);

  // Nothing here works without the property from step 1, so a plan that has not got that far
  // lands on the prompt to go back rather than on an empty grid.
  const hasProperty = boundaryDraft.closed && boundaryDraft.house !== null;
  const hasBrief = briefCompletion(brief).complete;
  const ready = hasProperty && hasBrief;

  /*
   * Arriving on this screen is itself the request to generate — the user pressed "Next:
   * Generate concepts" to get here. Guarded on an empty set rather than on mount, so coming
   * back from Compare or from step 3 does not throw away ideas the user was weighing up.
   */
  useEffect(() => {
    if (ready && concepts.length === 0 && generating === null) generateAll();
  }, [ready, concepts.length, generating, generateAll]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlanTopBar currentStep={4} />

      {/* Same three-column layout as steps 1 and 2: fixed side columns, canvas takes the rest. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-5 xl:overflow-hidden xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:min-h-0 xl:w-72 xl:shrink-0 xl:overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Sparkles aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Design concepts</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                Three ways to lay out your garden, generated from everything you have told us so
                far.
              </p>
            </div>
          </div>

          {ready ? <ConceptList /> : null}
        </aside>

        <main className="flex min-h-[480px] min-w-0 flex-1 flex-col gap-3 xl:min-h-0">
          {ready ? (
            <>
              <ConceptsToolbar />
              {generateError ? <GenerateErrorNotice message={generateError} /> : null}
              <div className="min-h-[420px] flex-1 xl:min-h-0">
                {compareOpen ? (
                  <CompareView />
                ) : (
                  <ConceptCanvasLoader concept={concept} variant="full" />
                )}
              </div>
              {generating ? <SlowGenerationHint /> : null}
            </>
          ) : (
            <NotReadyNotice hasProperty={hasProperty} />
          )}
        </main>

        <aside className="space-y-4 xl:min-h-0 xl:w-64 xl:shrink-0 xl:overflow-y-auto">
          <ConceptDetailsPanel concept={concept} />
          <ProjectBriefPanel />
          <ConceptLegendPanel />
        </aside>
      </div>

      <PlanBottomBar
        backHref={planHref('brief')}
        continueHref={planHref('editor')}
        continueLabel="Continue to editor"
        caption={chosen ? 'You can refine it on the next step.' : undefined}
        /*
         * Previewing a concept is not choosing one. Continue stays shut until the user has
         * pressed "Choose this concept", so the next step always knows which plan it is
         * reviewing.
         */
        blockedReason={chosen ? null : 'Choose a concept to continue.'}
      />
    </div>
  );
}

/**
 * A failed generation, in the user's own terms.
 *
 * New with the real service: the mock could neither fail nor be refused. A 422 names the spatial
 * problem and points at the step that owns it, because that is something the user can go and fix.
 */
function GenerateErrorNotice({ message }: { message: string }) {
  const planHref = usePlanHref();

  return (
    <p
      data-testid="generate-error"
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-garden-warn/40 bg-[#fdf0e0] px-3 py-2 text-xs text-garden-ink"
    >
      <CircleAlert aria-hidden className="h-4 w-4 shrink-0 text-garden-warn" />
      <span>{message}</span>
      <Link
        href={planHref('features')}
        data-testid="generate-error-fix"
        className="font-semibold text-garden-forest underline"
      >
        Go to existing features
      </Link>
    </p>
  );
}

/**
 * Shown while a generation is running, after a beat.
 *
 * A disabled button on its own reads as a hang once you are past a second or two, and real
 * generation takes a few seconds where the mock took 450 ms.
 */
function SlowGenerationHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <p data-testid="slow-generation" className="text-center text-[11px] text-garden-muted">
      Laying out your garden — this takes a few seconds.
    </p>
  );
}

function NotReadyNotice({ hasProperty }: { hasProperty: boolean }) {
  const planHref = usePlanHref();

  const { step, cta, body } = hasProperty
    ? {
        step: 'brief',
        cta: 'Back to Your vision',
        body: 'Concepts are generated from your budget, maintenance and style answers, so step 3 needs to be finished before this one.',
      }
    : {
        step: 'map',
        cta: 'Back to Map dimensions',
        body: 'Concepts are laid out on your boundary and house, so step 1 needs to be finished before this one.',
      };

  return (
    <div
      data-testid="concepts-not-ready"
      className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
        <Map aria-hidden className="h-6 w-6 text-garden-green" />
      </span>
      <h2 className="text-sm font-semibold text-garden-forest">
        {hasProperty ? 'Finish your brief first' : 'Map your outdoor space first'}
      </h2>
      <p className="max-w-sm text-xs leading-relaxed text-garden-muted">{body}</p>
      <Link
        href={planHref(step)}
        data-testid="concepts-go-back"
        className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
      >
        {cta}
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
    </div>
  );
}
