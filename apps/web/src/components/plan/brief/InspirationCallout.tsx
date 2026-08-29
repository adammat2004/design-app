'use client';

import { Lightbulb } from 'lucide-react';

/**
 * The right-column reassurance. Same markup as `TipCallout` and `FeaturesTipCallout`, but with
 * nothing to choose between — steps 1 and 2 tailor their tip to what the user is doing on the
 * canvas, and there is no equivalent state here worth branching on.
 *
 * That makes three copies of this card. Worth extracting a shared `<Callout>` if a fourth
 * appears; not worth editing two working screens for it today.
 */
export function InspirationCallout() {
  return (
    <section
      data-testid="inspiration-callout"
      className="rounded-xl border border-garden-line bg-garden-sage/50 p-3"
    >
      <div className="flex items-start gap-2.5">
        <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />
        <div>
          <p className="text-[11px] leading-relaxed text-garden-muted">
            <span className="font-semibold text-garden-ink">Need inspiration? </span>
            Not sure what to choose? Nothing here is final — every preference can be adjusted once
            you have seen the concepts.
          </p>
          <a
            href="/help/brief"
            data-testid="inspiration-learn-more"
            className="mt-1.5 inline-block text-[11px] font-medium text-garden-green underline underline-offset-2 hover:text-garden-forest"
          >
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
}
