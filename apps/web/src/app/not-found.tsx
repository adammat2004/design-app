import Link from 'next/link';
import { ArrowRight, SearchX } from 'lucide-react';

/**
 * A plan that is not there.
 *
 * Now genuinely means what it says. Until the layout learned to tell three failures apart, this
 * was also what someone saw when the API was not running — so the message had to be vague enough
 * to cover a case it was not describing. It can be specific now.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-garden-canvas p-6 text-center">
      <div
        data-testid="plan-not-found"
        className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-garden-line bg-white p-10 shadow-sm"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
          <SearchX aria-hidden className="h-6 w-6 text-garden-green" />
        </span>

        <h1 className="text-sm font-semibold text-garden-forest">No plan here</h1>

        <p className="text-xs leading-relaxed text-garden-muted">
          This link does not point at a plan. It may have been deleted, or the address may have been
          mistyped.
        </p>

        <Link
          href="/plan"
          data-testid="start-new-plan"
          className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
        >
          Start a new plan
          <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
