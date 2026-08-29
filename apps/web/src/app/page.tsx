import Link from 'next/link';
import { ArrowRight, Sprout } from 'lucide-react';

/**
 * The front door. Deliberately thin — it exists so `/` is not the plan wizard itself, which
 * would make the wizard's "Exit mapping" link a no-op, and so the flow has one obvious entry
 * point. Everything the tool does lives under `/plan`.
 */
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-garden-canvas text-garden-ink">
      <main className="flex flex-1 items-center justify-center p-6">
        <div
          data-testid="home-hero"
          className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
            <Sprout aria-hidden className="h-6 w-6 text-garden-green" />
          </span>

          <h1 className="text-lg font-semibold text-garden-forest">Garden Studio</h1>

          <p className="text-xs leading-relaxed text-garden-muted">
            Map your outdoor space, tell us what you want from it, and compare design concepts you
            can edit. Nothing is saved between visits yet.
          </p>

          {/* `/plan` creates a plan and redirects into it, so the id is minted server-side. */}
          <Link
            href="/plan"
            data-testid="start-planning"
            className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
          >
            Start planning
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
