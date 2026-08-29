'use client';

import { Ban } from 'lucide-react';
import { summariseFeatures } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';
import { FeatureIcon } from './FeatureIcon';
import { StatusPill } from './StatusPill';

/**
 * A summary view, not the primary control. Status is set on the plan itself, where the user can
 * see the thing they are deciding about; this list is for finding something that has scrolled
 * off screen and for reading the totals.
 */
export function PlacedFeatureList() {
  const features = useFeaturesStore((state) => state.present.features);
  const selectedIds = useFeaturesStore((state) => state.selectedIds);
  const skipped = useFeaturesStore((state) => state.skipped);
  const select = useFeaturesStore((state) => state.select);
  const setSkipped = useFeaturesStore((state) => state.setSkipped);

  const summary = summariseFeatures(features);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Placed features ({summary.total})</h2>

      {features.length === 0 ? (
        <p
          data-testid="placed-features-empty"
          className="mt-2 text-[11px] leading-relaxed text-garden-muted"
        >
          Nothing placed yet. Pick a feature type above, or skip this step if the garden is bare.
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

      {/*
        Plenty of properties genuinely have nothing worth mapping. Saying so is a real answer,
        so it is recorded rather than left as an empty list step 3 has to guess about.
      */}
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-dashed border-garden-line px-2 py-2 hover:bg-garden-sage/40">
        <input
          type="checkbox"
          data-testid="skip-step"
          checked={skipped}
          onChange={(event) => setSkipped(event.target.checked)}
          className="sr-only"
        />
        <span
          className={[
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
            skipped
              ? 'border-garden-green bg-garden-green text-white'
              : 'border-garden-line bg-white',
          ].join(' ')}
        >
          {skipped ? <Ban aria-hidden className="h-3 w-3" /> : null}
        </span>
        <span className="text-[11px] leading-relaxed text-garden-muted">
          Nothing to add — skip this step.
        </span>
      </label>
    </section>
  );
}
