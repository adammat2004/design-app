'use client';

import { Star } from 'lucide-react';
import type { GeneratedConcept } from '@/lib/concepts';
import { useRelativeTime } from '@/lib/use-relative-time';
import { useConceptsStore } from '@/state/concepts-store';
import { BudgetPill, MaintenancePill } from '../concepts/ConceptPills';

/**
 * Which concept is being edited, kept in the corner of the screen so the plan on the canvas
 * always has a name attached to it.
 *
 * The timestamp comes from the concepts store's `lastSavedAt` — the moment this set was
 * generated — rather than from the editor's, which moves on every edit. "Last generated" has to
 * mean generated.
 */
export function ConceptSummaryCard({ concept }: { concept: GeneratedConcept }) {
  const generatedAt = useConceptsStore((state) => state.lastSavedAt);
  const ago = useRelativeTime(generatedAt);

  return (
    <section
      data-testid="editor-concept-summary"
      className="rounded-xl border border-garden-line bg-garden-sage/40 p-3"
    >
      <h2 className="text-xs font-semibold text-garden-ink">Your concept</h2>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p data-testid="editor-concept-name" className="text-sm font-semibold text-garden-forest">
          {concept.name}
        </p>
        {concept.recommended ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-garden-green px-1.5 py-px text-[9px] font-semibold text-garden-green">
            <Star aria-hidden className="h-2.5 w-2.5" />
            Recommended
          </span>
        ) : null}
      </div>

      <p className="mt-0.5 text-[11px] text-garden-muted">Last generated {ago}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <BudgetPill band={concept.budget} />
        <MaintenancePill level={concept.maintenance} />
      </div>
    </section>
  );
}
