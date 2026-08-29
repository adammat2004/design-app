'use client';

import { Check, Star } from 'lucide-react';
import type { Point } from '@garden-studio/schema';
import { countIncluded, type GeneratedConcept } from '@/lib/concepts';
import type { HouseFootprint } from '@/lib/house';
import { useConceptsStore } from '@/state/concepts-store';
import { BudgetPill, MaintenancePill } from './ConceptPills';
import { ConceptThumbnail } from './ConceptThumbnail';

/**
 * One generated option in the left-hand list.
 *
 * The card is a radio, not a button: exactly one concept is on the canvas at a time, and the
 * round badge in the corner is the same "one of these" signal `brief/ChoiceCard.tsx`
 * established on step 3. Compare mode is the exception — there the tick box is square, because
 * comparing is a many-selection.
 */
export function ConceptCard({
  concept,
  boundary,
  house,
  selected,
  chosen,
  compareMode,
  comparing,
  regenerating,
}: {
  concept: GeneratedConcept;
  boundary: Point[];
  house: HouseFootprint | null;
  selected: boolean;
  chosen: boolean;
  compareMode: boolean;
  comparing: boolean;
  regenerating: boolean;
}) {
  const select = useConceptsStore((state) => state.select);
  const toggleCompare = useConceptsStore((state) => state.toggleCompare);
  const included = countIncluded(concept);

  return (
    <label
      data-testid={`concept-card-${concept.id}`}
      data-selected={selected}
      data-chosen={chosen}
      className={[
        'relative flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-2.5 transition-colors',
        'focus-within:ring-2 focus-within:ring-garden-green',
        selected
          ? 'border-garden-green bg-garden-sage/40 shadow-sm'
          : 'border-garden-line bg-white hover:border-garden-green hover:bg-garden-sage/30',
        regenerating ? 'animate-pulse' : '',
      ].join(' ')}
    >
      <input
        type={compareMode ? 'checkbox' : 'radio'}
        name="concept"
        data-testid={compareMode ? `compare-${concept.id}` : `select-${concept.id}`}
        checked={compareMode ? comparing : selected}
        onChange={() => (compareMode ? toggleCompare(concept.id) : select(concept.id))}
        aria-label={compareMode ? `Compare ${concept.name}` : `Show ${concept.name} on the plan`}
        className="sr-only"
      />

      <div className="flex items-center gap-1.5">
        {concept.recommended ? (
          <span
            data-testid={`recommended-${concept.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-garden-green px-1.5 py-px text-[9px] font-semibold text-white"
          >
            <Star aria-hidden className="h-2.5 w-2.5" />
            Recommended
          </span>
        ) : null}

        {chosen ? (
          <span
            data-testid={`chosen-${concept.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-garden-forest px-1.5 py-px text-[9px] font-semibold text-white"
          >
            <Check aria-hidden className="h-2.5 w-2.5" />
            Chosen
          </span>
        ) : null}

        <span
          aria-hidden
          className={[
            'ml-auto flex h-4 w-4 items-center justify-center border-2 transition-colors',
            // Square for compare (many), round for selection (one) — step 3's rule.
            compareMode ? 'rounded' : 'rounded-full',
            (compareMode ? comparing : selected)
              ? 'border-transparent bg-garden-green text-white'
              : 'border-garden-line bg-white',
          ].join(' ')}
        >
          {(compareMode ? comparing : selected) ? <Check className="h-2.5 w-2.5" /> : null}
        </span>
      </div>

      <ConceptThumbnail concept={concept} boundary={boundary} house={house} />

      <div>
        <p className="text-xs font-semibold text-garden-ink">{concept.name}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-garden-muted">{concept.summary}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <BudgetPill band={concept.budget} testId={`card-budget-${concept.id}`} />
        <MaintenancePill level={concept.maintenance} testId={`card-maintenance-${concept.id}`} />
      </div>

      {/* Read off the concept's own checks, so a card can never claim more than it contains. */}
      {included.total > 0 ? (
        <p data-testid={`card-included-${concept.id}`} className="text-[10px] text-garden-muted">
          {included.included} of {included.total} requested features included
        </p>
      ) : null}
    </label>
  );
}
