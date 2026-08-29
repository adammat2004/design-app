'use client';

import { Sparkles } from 'lucide-react';
import { draftPolygon } from '@/lib/boundary-geometry';
import { useBoundaryStore } from '@/state/boundary-store';
import { useConceptsStore } from '@/state/concepts-store';
import { ConceptCard } from './ConceptCard';

/**
 * The left column: every concept in the current set, then the button that throws them all away
 * and rolls again.
 *
 * The count in the subtitle is read off the set rather than written as "3" — the generator
 * decides how many it produced, and a subtitle that disagreed with the list under it would be
 * the first thing a marker noticed.
 */
export function ConceptList() {
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const concepts = useConceptsStore((state) => state.present.concepts);
  const selectedId = useConceptsStore((state) => state.present.selectedId);
  const chosenConceptId = useConceptsStore((state) => state.chosenConceptId);
  const generating = useConceptsStore((state) => state.generating);
  const compareOpen = useConceptsStore((state) => state.compareOpen);
  const compareIds = useConceptsStore((state) => state.compareIds);
  const generateAll = useConceptsStore((state) => state.generateAll);

  const boundary = draftPolygon(boundaryDraft);
  const busy = generating !== null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-garden-ink">Generated concepts</h2>
        <p data-testid="concepts-subtitle" className="mt-0.5 text-[11px] text-garden-muted">
          {concepts.length > 0
            ? `${concepts.length} AI-generated options based on your goals.`
            : 'Generating options based on your goals…'}
        </p>
      </div>

      {compareOpen ? (
        <p className="rounded-lg border border-dashed border-garden-line bg-garden-sage/40 px-2.5 py-2 text-[11px] leading-relaxed text-garden-muted">
          Tick two or more concepts to see them side by side.
        </p>
      ) : null}

      <div data-testid="concept-cards" className="space-y-2.5">
        {concepts.map((concept) => (
          <ConceptCard
            key={concept.id}
            concept={concept}
            boundary={boundary}
            house={boundaryDraft.house}
            selected={concept.id === selectedId}
            chosen={concept.id === chosenConceptId}
            compareMode={compareOpen}
            comparing={compareIds.includes(concept.id)}
            regenerating={generating === concept.id}
          />
        ))}

        {concepts.length === 0
          ? Array.from({ length: 3 }, (_, index) => (
              <span
                key={index}
                aria-hidden
                className="block h-44 w-full animate-pulse rounded-xl border border-garden-line bg-white"
              />
            ))
          : null}
      </div>

      <button
        type="button"
        data-testid="generate-new"
        disabled={busy}
        onClick={generateAll}
        className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-garden-line bg-white p-3 text-left transition-colors hover:border-garden-green hover:bg-garden-sage/40 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-garden-sage">
          <Sparkles
            aria-hidden
            className={[
              'h-4 w-4 text-garden-green',
              generating === 'all' ? 'animate-spin' : '',
            ].join(' ')}
          />
        </span>
        <span>
          <span className="block text-xs font-semibold text-garden-ink">
            {generating === 'all' ? 'Generating…' : 'Generate 3 new concepts'}
          </span>
          <span className="block text-[11px] text-garden-muted">Fresh ideas in seconds</span>
        </span>
      </button>
    </div>
  );
}
