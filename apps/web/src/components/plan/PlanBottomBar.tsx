'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, CircleAlert, CircleCheck, LogOut } from 'lucide-react';
import { checkPlotSanity } from '@garden-studio/schema';
import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { formatArea } from '@/lib/units';
import { useRelativeTime } from '@/lib/use-relative-time';
import { useBoundaryStore } from '@/state/boundary-store';
import { flushAll, selectSaving, useSyncStore } from '@/state/project-sync';

/**
 * Shared across the wizard's steps. Where Continue goes, and what stops it, belong to the
 * screen rather than to the bar — step 1 cannot continue without a house, step 2 is happy to
 * continue with nothing placed at all.
 */
export function PlanBottomBar({
  backHref,
  continueHref,
  continueLabel = 'Continue',
  caption,
  blockedReason = null,
}: {
  /**
   * The previous step. Steps 1 to 3 leave this off: they carry their own back-links in the
   * left column, and a step that can only be entered from the one before it does not need two.
   * Step 4 has no such link, because its left column is the concept list.
   */
  backHref?: string;
  continueHref: string;
  /** Step 3 names what it continues to, since it is the last input screen. */
  continueLabel?: string;
  /** Reassurance under the button group. Renders nothing when absent, as on steps 1 and 2. */
  caption?: string;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const saving = useSyncStore(selectSaving);
  const savedAt = useSyncStore((state) => state.savedAt);
  const error = useSyncStore((state) => state.error);
  const savedAgo = useRelativeTime(savedAt);
  const [leaving, setLeaving] = useState(false);

  /*
   * The running plot area, on every step rather than only on the mapping screen.
   *
   * It reads the boundary store directly instead of taking a prop because it is the same number
   * on every step and hydration fills that store before any screen renders. A plot drawn ten
   * times too big is invisible on a blank grid and obvious the moment its area is written down,
   * so the number has to be somewhere the user cannot avoid seeing it — and it has to keep
   * updating while they draw, which a summary panel behind a "closed" check would not.
   */
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const polygon = draftPolygon(draft);
  const outOfBand = draft.closed && checkPlotSanity(polygon, unit) !== null;

  /**
   * Continue waits for the save to land before navigating.
   *
   * Load-bearing rather than tidy: once generation runs server-side, arriving at step 4 before
   * the brief has been written would generate a garden against a stale document.
   */
  async function handleContinue() {
    setLeaving(true);
    try {
      await flushAll();
      router.push(continueHref);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <footer className="flex flex-wrap items-center gap-3 border-t border-garden-line bg-white px-4 py-3 lg:px-6">
      {backHref ? (
        <Link
          href={backHref}
          data-testid="back"
          className="flex items-center gap-2 rounded-full border border-garden-line px-4 py-2 text-sm font-medium text-garden-ink hover:bg-garden-sage"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back
        </Link>
      ) : null}

      <Link
        href="/"
        data-testid="exit-mapping"
        className="flex items-center gap-2 rounded-full border border-garden-line px-4 py-2 text-sm font-medium text-garden-ink hover:bg-garden-sage"
      >
        <LogOut aria-hidden className="h-4 w-4" />
        Exit
      </Link>

      {polygon.length >= 3 ? (
        <p
          data-testid="plot-area"
          data-out-of-band={outOfBand}
          title="Total plot area, measured off the boundary as you draw it"
          className="flex items-center gap-1.5 text-xs"
        >
          <span className="text-garden-muted">Plot</span>
          <span
            className={outOfBand ? 'font-semibold text-garden-warn' : 'font-medium text-garden-ink'}
          >
            {formatArea(polygonArea(polygon), unit)}
          </span>
        </p>
      ) : null}

      <p
        data-testid="autosave-status"
        role="status"
        data-state={error ? 'error' : saving ? 'saving' : 'saved'}
        className={[
          'order-last flex w-full items-center justify-center gap-2 text-xs sm:order-none sm:mx-auto sm:w-auto',
          error ? 'text-garden-warn' : 'text-garden-muted',
        ].join(' ')}
      >
        {error ? (
          <>
            <CircleAlert aria-hidden className="h-4 w-4" />
            <span>{error}</span>
          </>
        ) : saving ? (
          <span>Saving…</span>
        ) : (
          <>
            <CircleCheck aria-hidden className="h-4 w-4 text-garden-green" />
            <span>Saved</span>
            <span aria-hidden>·</span>
            <span>{savedAgo}</span>
          </>
        )}
      </p>

      <div className="ml-auto flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="save-draft"
            onClick={() => void flushAll()}
            className="flex items-center gap-2 rounded-full border border-garden-line px-4 py-2 text-sm font-medium text-garden-ink hover:bg-garden-sage"
          >
            <Bookmark aria-hidden className="h-4 w-4" />
            Save now
          </button>

          {/*
            A button rather than a link, because it has to await the save first. The disabled
            state is still driven by the screen's own `blockedReason`.
          */}
          <button
            type="button"
            data-testid="continue"
            disabled={blockedReason !== null || leaving}
            title={blockedReason ?? undefined}
            onClick={handleContinue}
            className={[
              'flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white',
              blockedReason !== null
                ? 'cursor-not-allowed opacity-40'
                : leaving
                  ? 'opacity-70'
                  : 'hover:bg-garden-green',
            ].join(' ')}
          >
            {continueLabel}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {caption ? (
          <p data-testid="continue-caption" className="text-[11px] text-garden-muted">
            {caption}
          </p>
        ) : null}
      </div>

      {blockedReason ? <p className="sr-only">{blockedReason}</p> : null}
    </footer>
  );
}
