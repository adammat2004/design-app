'use client';

import { BUDGET_BANDS } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { BudgetIcon } from './BriefIcons';
import { ChoiceCard } from './ChoiceCard';

/**
 * Section 3. Each band carries its own tint so the four read as a ladder at a glance; the
 * green border and badge still carry selection, so tint never has to do two jobs.
 */
export function BudgetPicker() {
  const budget = useBriefStore((state) => state.present.budget);
  const setBudget = useBriefStore((state) => state.setBudget);

  return (
    <ul
      role="radiogroup"
      aria-label="Budget band"
      data-testid="budget-bands"
      className="grid grid-cols-2 gap-2.5"
    >
      {BUDGET_BANDS.map((band) => {
        const chosen = budget === band.id;

        return (
          <li key={band.id}>
            <ChoiceCard
              testId={`budget-${band.id}`}
              name="budget"
              label={`${band.label}, ${band.range}`}
              checked={chosen}
              onSelect={() => setBudget(band.id)}
              tint={band.tint}
              accent={band.accent}
            >
              {/* The band's own colour, so the icon belongs to the tint behind it. */}
              <span style={{ color: band.accent }}>
                <BudgetIcon id={band.id} className="h-4 w-4" />
              </span>
              <span
                style={{ color: chosen ? band.accent : undefined }}
                className="mt-2 text-xs font-semibold text-garden-ink"
              >
                {band.label}
              </span>
              <span className="mt-0.5 text-sm font-semibold text-garden-forest">{band.range}</span>
            </ChoiceCard>
          </li>
        );
      })}
    </ul>
  );
}
