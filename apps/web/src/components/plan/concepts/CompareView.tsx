'use client';

import { Check, Columns2, Star } from 'lucide-react';
import { countIncluded, type GeneratedConcept } from '@/lib/concepts';
import { useConceptsStore } from '@/state/concepts-store';
import { ConceptCanvasLoader } from './ConceptCanvasLoader';
import { BudgetPill, MaintenancePill } from './ConceptPills';

/**
 * Two or more concepts, side by side.
 *
 * Panes rather than a table of numbers: the difference between these three options is almost
 * entirely spatial — where the patio went, how much of the garden is planting — and a stats
 * table would compare the one part of a concept that is *not* the interesting part. Each pane
 * is a real canvas, fitted independently, so the plans stay to proportion against each other.
 *
 * Labels and chrome are off in pane mode. At this size they would collide into noise, and the
 * question a comparison answers is "which shape do I prefer", not "how wide is that path".
 */
export function CompareView() {
  const concepts = useConceptsStore((state) => state.present.concepts);
  const compareIds = useConceptsStore((state) => state.compareIds);
  const selectedId = useConceptsStore((state) => state.present.selectedId);
  const chosenConceptId = useConceptsStore((state) => state.chosenConceptId);
  const select = useConceptsStore((state) => state.select);

  // Plan order, not tick order, so the panes do not reshuffle as boxes are ticked.
  const showing = concepts.filter((concept) => compareIds.includes(concept.id));

  if (showing.length < 2) {
    return (
      <div
        data-testid="compare-empty"
        className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
          <Columns2 aria-hidden className="h-6 w-6 text-garden-green" />
        </span>
        <h2 className="text-sm font-semibold text-garden-forest">Pick two to compare</h2>
        <p className="max-w-sm text-xs leading-relaxed text-garden-muted">
          Tick the concepts you want to weigh up in the list on the left and they will appear here
          side by side.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="compare-view"
      className={[
        'grid h-full min-h-[420px] gap-3',
        showing.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
      ].join(' ')}
    >
      {showing.map((concept) => (
        <ComparePane
          key={concept.id}
          concept={concept}
          selected={concept.id === selectedId}
          chosen={concept.id === chosenConceptId}
          onSelect={() => select(concept.id)}
        />
      ))}
    </div>
  );
}

function ComparePane({
  concept,
  selected,
  chosen,
  onSelect,
}: {
  concept: GeneratedConcept;
  selected: boolean;
  chosen: boolean;
  onSelect: () => void;
}) {
  const included = countIncluded(concept);

  return (
    <section
      data-testid={`compare-pane-${concept.id}`}
      data-selected={selected}
      className={[
        'flex min-h-0 flex-col gap-2 rounded-xl border-2 p-2',
        selected ? 'border-garden-green bg-garden-sage/30' : 'border-garden-line bg-white',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-garden-ink">
            {concept.recommended ? (
              <Star aria-hidden className="h-3 w-3 shrink-0 text-garden-green" />
            ) : null}
            {concept.name}
          </p>
          <p className="mt-0.5 text-[10px] text-garden-muted">
            {included.included} of {included.total} requested · {concept.style}
          </p>
        </div>

        <button
          type="button"
          data-testid={`compare-select-${concept.id}`}
          onClick={onSelect}
          className={[
            'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors',
            'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
            selected
              ? 'border-garden-green bg-garden-green text-white'
              : 'border-garden-line text-garden-ink hover:bg-garden-sage',
          ].join(' ')}
        >
          {selected ? (
            <span className="flex items-center gap-1">
              <Check aria-hidden className="h-2.5 w-2.5" />
              Showing
            </span>
          ) : (
            'Select'
          )}
        </button>
      </header>

      <div className="min-h-[240px] flex-1">
        <ConceptCanvasLoader concept={concept} variant="pane" />
      </div>

      <footer className="flex flex-wrap items-center gap-1.5">
        <BudgetPill band={concept.budget} />
        <MaintenancePill level={concept.maintenance} />
        {chosen ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-garden-forest px-1.5 py-px text-[9px] font-semibold text-white">
            <Check aria-hidden className="h-2.5 w-2.5" />
            Chosen
          </span>
        ) : null}
      </footer>
    </section>
  );
}
