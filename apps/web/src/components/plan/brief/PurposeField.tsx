'use client';

import { PURPOSE_LIMIT, PURPOSE_WARN } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';

/**
 * Section 1. The only place on the wizard where the user writes prose, and the only textarea
 * in the app.
 *
 * The store clamps as well as `maxLength`, because `maxLength` does not stop a programmatic
 * paste — see `setPurpose`.
 */
export function PurposeField() {
  const purpose = useBriefStore((state) => state.present.purpose);
  const setPurpose = useBriefStore((state) => state.setPurpose);

  const nearingCap = purpose.length >= PURPOSE_WARN;

  return (
    <div>
      <textarea
        data-testid="brief-purpose"
        aria-label="How you want to use this space"
        value={purpose}
        maxLength={PURPOSE_LIMIT}
        rows={4}
        onChange={(event) => setPurpose(event.target.value)}
        placeholder="e.g. Somewhere for the children to play, plenty of seating for entertaining in summer, and easy to look after."
        className="min-h-28 w-full resize-y rounded-lg border border-garden-line bg-white px-3 py-2 text-sm leading-relaxed text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-green focus-visible:outline-none"
      />

      <p
        data-testid="purpose-counter"
        role="status"
        aria-live="polite"
        className={[
          'mt-1 text-right text-[11px] tabular-nums',
          nearingCap ? 'font-medium text-garden-warn' : 'text-garden-muted',
        ].join(' ')}
      >
        {purpose.length} / {PURPOSE_LIMIT}
        {nearingCap ? <span className="sr-only"> characters used — nearing the limit</span> : null}
      </p>
    </div>
  );
}
