'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  checkPlotSanity,
  scalePolygonAbout,
  SCALE_DOWN_FACTOR,
  type PlotSanityCode,
} from '@garden-studio/schema';
import { draftPolygon, polygonArea, polygonCentroid } from '@/lib/boundary-geometry';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * Says so when the plot does not look like a garden, and offers the fix.
 *
 * A warning rather than a block, deliberately and consistently with the rest of the document
 * layer: an out-of-band plot is unusual, not illegal, and a genuinely large rural site is a real
 * thing somebody might have. What the user must not be able to do is walk past the mistake
 * without noticing it, which is what happened before — a 113 x 74.5 m plot was accepted in
 * silence, and every screen after it was designing a field.
 *
 * Dismissal is keyed on the *code*, not on the numbers: saying "this is right" about a plot that
 * really is 3,000 m² should not make the warning reappear on the next vertex nudge, but tripping
 * a different band later is new information and deserves to be said.
 */
export function PlotSanityCallout() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const scalePlot = useBoundaryStore((state) => state.scalePlot);
  const [dismissed, setDismissed] = useState<PlotSanityCode | null>(null);

  // Only once the outline is closed: `longestEdge` walks the wrapping edge, which on a half-drawn
  // polygon is the long line back to the first corner and would trip on nearly every plot.
  const polygon = draft.closed ? draftPolygon(draft) : [];
  const warning = polygon.length >= 3 ? checkPlotSanity(polygon, unit) : null;

  if (!warning || warning.code === dismissed) return null;

  const scaledArea = polygonArea(
    scalePolygonAbout(polygon, polygonCentroid(polygon), 1 / SCALE_DOWN_FACTOR),
  );

  return (
    <section
      data-testid="plot-sanity"
      data-code={warning.code}
      role="status"
      className="rounded-xl border border-garden-warn/40 bg-garden-warn/10 p-3"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-warn" />
        <div className="min-w-0">
          <p data-testid="plot-sanity-headline" className="text-xs font-semibold text-garden-ink">
            {warning.headline}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">{warning.detail}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/*
              Offered only when it actually clears the warning. A button that leaves the same
              banner on screen teaches the user that the fix does not work.
            */}
            {warning.scaleDownHelps ? (
              <button
                type="button"
                data-testid="scale-plot-down"
                onClick={() => scalePlot(1 / SCALE_DOWN_FACTOR)}
                className="rounded-full bg-garden-forest px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-garden-green"
              >
                {`Scale down ${SCALE_DOWN_FACTOR}× → ${formatArea(scaledArea, unit)}`}
              </button>
            ) : null}

            <button
              type="button"
              data-testid="dismiss-plot-sanity"
              onClick={() => setDismissed(warning.code)}
              className="rounded-full border border-garden-line bg-white px-3 py-1.5 text-[11px] font-medium text-garden-ink hover:bg-garden-sage"
            >
              This is right
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
