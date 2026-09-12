'use client';

import { Hand, Lightbulb, Sparkles } from 'lucide-react';

/**
 * The two routes onto the plan, said out loud.
 *
 * Worth a card each rather than being left implicit. Drawing is discoverable — there is a palette
 * right above it — but "you can just describe it" is not, and a user who does not know the
 * assistant exists will map the whole garden by hand or skip the step entirely.
 */
export function WaysToAdd({ onDescribe }: { onDescribe: () => void }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Ways to add features</h2>

      <div className="mt-2 space-y-2">
        <div
          data-testid="way-manual"
          className="flex items-start gap-2.5 rounded-xl border border-garden-line bg-white p-2.5"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-garden-sage">
            <Hand aria-hidden className="h-3.5 w-3.5 text-garden-green" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-garden-ink">Add manually</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">
              Tap a feature above, then place it on the plan.
            </span>
          </span>
        </div>

        <button
          type="button"
          data-testid="way-describe"
          onClick={onDescribe}
          className="flex w-full items-start gap-2.5 rounded-xl border border-garden-line bg-white p-2.5 text-left transition-colors hover:border-garden-green hover:bg-garden-sage/40 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-garden-sage">
            <Sparkles aria-hidden className="h-3.5 w-3.5 text-garden-green" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-garden-ink">
              Describe your garden
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">
              Tell our assistant what you have and it will add features for you.
            </span>
          </span>
        </button>
      </div>

      <p
        data-testid="only-map-what-matters"
        className="mt-2 flex items-start gap-1.5 rounded-lg bg-garden-sage/50 px-2 py-1.5 text-[11px] leading-relaxed text-garden-muted"
      >
        <Lightbulb aria-hidden className="mt-px h-3 w-3 shrink-0 text-garden-green" />
        You only need to add features the design should work around, such as mature trees, sheds or
        existing patios.
      </p>
    </section>
  );
}
