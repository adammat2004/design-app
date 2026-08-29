'use client';

import { Info } from 'lucide-react';

export function HowThisWorksCallout() {
  return (
    <section
      data-testid="how-this-works"
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-xs font-semibold text-garden-ink">
        <Info aria-hidden className="h-4 w-4 text-garden-green" />
        How this works
      </h2>
      <p className="mt-2 text-[11px] leading-relaxed text-garden-muted">
        Add the features already on your property. For each one, choose Keep, Remove or Replace in a
        single pass — the colour on the plan tells you at a glance what is happening where.
      </p>
    </section>
  );
}
