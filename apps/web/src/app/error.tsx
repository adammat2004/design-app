'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/**
 * The last line before a white screen.
 *
 * There was no error boundary anywhere in this app, which meant any throw below the root — a bad
 * palette hex, a Konva node in a state it did not expect, a fetch that failed in a way nothing
 * caught — took the whole page down to nothing. That is the worst possible failure for a tool
 * someone has spent twenty minutes drawing in, because it looks like the work is gone. It is not:
 * every section autosaves, so the honest and useful thing to say first is that the plan is safe.
 *
 * **Recovering in place beats a reload.** Retrying re-runs the failed fetch without discarding the
 * client stores, so a transient failure costs nothing. A reload would throw away everything the
 * user has done since the last autosave settled.
 *
 * **`retry()`, not `reset()`.** Next 16 demoted `reset` — it clears the error state and re-renders
 * the children *without re-fetching*, which is useless here: what failed was a server fetch of the
 * plan, so re-rendering the same failed data just fails again. `retry()` re-runs the fetch. This is
 * exactly the trap `apps/web/AGENTS.md` warns about; `reset` is the Next 14/15 name and the one
 * that comes to hand from memory.
 *
 * `digest` is shown because in a production build it is the *only* identifier that survives —
 * Next scrubs server error messages — and it is what makes a bug report actionable rather than
 * "it broke".
 */
export default function PlanError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The one place a stack is still available. Without this a production failure leaves no trace
    // at all in the console, which is where anyone debugging looks first.
    console.error('Unhandled error in the plan wizard:', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-garden-canvas p-6 text-center">
      <div
        data-testid="plan-error"
        className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-garden-line bg-white p-10 shadow-sm"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
          <TriangleAlert aria-hidden className="h-6 w-6 text-garden-green" />
        </span>

        <h1 className="text-sm font-semibold text-garden-forest">Something went wrong</h1>

        <p className="text-xs leading-relaxed text-garden-muted">
          Your plan is saved. This screen failed to draw, which has not changed anything about the
          garden itself.
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="error-retry"
            onClick={() => retry()}
            className="flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Try again
          </button>

          <Link
            href="/"
            className="rounded-full border border-garden-line px-4 py-2 text-xs font-semibold text-garden-forest hover:bg-garden-sage"
          >
            Start over
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-1 text-[10px] text-garden-muted">
            Reference <code className="text-garden-ink">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
