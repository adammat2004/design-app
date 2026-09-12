'use client';

import { summariseFeatures } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';
import { FeatureIcon } from './FeatureIcon';
import { StatusPill } from './StatusPill';

/**
 * A summary view, not the primary control. Status is set on the plan itself, where the user can
 * see the thing they are deciding about; this list is for finding something that has scrolled
 * off screen and for reading the totals.
 *
 * The "nothing to add" checkbox that used to live at the bottom is gone: skipping is a real answer
 * and now has a real button in the bottom bar. Two controls writing one flag — one of which also
 * navigated and one of which did not — was the confusing half of the old screen.
 */
export function PlacedFeatureList() {
  const features = useFeaturesStore((state) => state.present.features);
  const selectedIds = useFeaturesStore((state) => state.selectedIds);
  const select = useFeaturesStore((state) => state.select);

  const summary = summariseFeatures(features);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Placed features ({summary.total})</h2>

      {features.length === 0 ? (
        <p
          data-testid="placed-features-empty"
          className="mt-2 text-[11px] leading-relaxed text-garden-muted"
        >
          Nothing placed yet. Pick a feature above, describe your garden, or skip this step.
        </p>
      ) : (
        <>
          <ul data-testid="placed-features" className="mt-2 space-y-1">
            {features.map((feature) => (
              <li key={feature.id}>
                <button
                  type="button"
                  data-testid={`placed-feature-${feature.id}`}
                  aria-pressed={selectedIds.includes(feature.id)}
                  // Shift extends the selection here exactly as it does on the plan.
                  onClick={(event) => select(feature.id, { additive: event.shiftKey })}
                  className={[
                    'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
                    selectedIds.includes(feature.id)
                      ? 'border-garden-green bg-garden-sage/60'
                      : 'border-transparent hover:bg-garden-sage/40',
                  ].join(' ')}
                >
                  <FeatureIcon kind={feature.kind} className="h-4 w-4 shrink-0 text-garden-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs text-garden-ink">
                    {feature.name}
                  </span>
                  <StatusPill status={feature.status} />
                </button>
              </li>
            ))}
          </ul>

          {/* Computed, never stored — the counts cannot drift from the list above them. */}
          <p
            data-testid="feature-summary"
            className="mt-2 rounded-lg bg-garden-sage/50 px-2 py-1.5 text-[11px] text-garden-muted"
          >
            <span className="font-medium text-garden-ink">
              {summary.total} feature{summary.total === 1 ? '' : 's'} placed
            </span>
            {` · ${summary.keep} keep · ${summary.remove} remove · ${summary.replace} replace`}
          </p>
        </>
      )}
    </section>
  );
}
