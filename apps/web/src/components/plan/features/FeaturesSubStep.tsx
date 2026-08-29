'use client';

import { Check } from 'lucide-react';
import { summariseFeatures } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';

/**
 * Progress within step 2. There is only one sub-step here, unlike step 1's draw-then-place, but
 * the row is kept so the two screens read as the same wizard rather than two different tools.
 */
export function FeaturesSubStep() {
  const features = useFeaturesStore((state) => state.present.features);
  const skipped = useFeaturesStore((state) => state.skipped);

  const summary = summariseFeatures(features);
  const done = skipped || summary.total > 0;

  return (
    <ol data-testid="sub-steps" className="space-y-2">
      <li>
        <div
          data-testid="sub-step-features"
          data-done={done}
          aria-current="step"
          className="flex w-full items-start gap-3 rounded-xl border border-garden-green bg-garden-sage/50 p-3 text-left"
        >
          <span
            className={[
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
              done ? 'bg-garden-green' : 'bg-garden-forest',
            ].join(' ')}
          >
            {done ? <Check aria-hidden className="h-3.5 w-3.5" /> : 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-garden-ink">Existing features</span>
              <span className="rounded-full bg-garden-green px-1.5 py-px text-[9px] font-semibold text-white">
                Active
              </span>
            </span>
            {/* The keep/remove/replace tally belongs to the placed-features list below, and is
                deliberately not repeated here. */}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">
              {skipped
                ? 'Marked as nothing to add.'
                : 'Place features and mark whether they stay, go, or get replaced.'}
            </span>
          </span>
        </div>
      </li>
    </ol>
  );
}
