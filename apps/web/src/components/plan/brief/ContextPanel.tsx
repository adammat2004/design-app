'use client';

import Link from 'next/link';
import { ArrowLeft, Check, Replace, Trash2, type LucideIcon } from 'lucide-react';
import { zoneScopeLabel } from '@/lib/brief';
import { STATUS_COLOURS, STATUS_ORDER } from '@/lib/feature-colours';
import { draftPolygon } from '@/lib/boundary-geometry';
import { summariseFeatures } from '@/lib/features';
import type { FeatureStatus } from '@/lib/features';
import { effectiveZoneIds, selectZones, useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';
import { usePlanHref } from '../ProjectContext';
import { PropertyThumbnail } from './PropertyThumbnail';

const STATUS_ICONS: Record<FeatureStatus, LucideIcon> = {
  keep: Check,
  remove: Trash2,
  replace: Replace,
};

/**
 * Steps 1 and 2, restated so the user can answer step 3 without going back to look.
 *
 * Read-only by design — everything here is derived, nothing is a second copy. The features tally
 * comes from `summariseFeatures`, the same function step 2's own list uses, and the colours come
 * from `STATUS_COLOURS`, so the two screens agree by construction rather than by matching hexes.
 *
 * **A strip rather than a sidebar panel**, since the artwork below it took the page's full width.
 * That is not only layout: this is context, and context belongs beside the heading it qualifies
 * rather than in a column of its own competing with the question. It also keeps the plan thumbnail
 * small, which is right — it is a reminder of a plot you have already drawn, not a drawing to
 * study.
 */
export function ContextPanel() {
  const planHref = usePlanHref();
  const draft = useBoundaryStore((state) => state.present);
  const features = useFeaturesStore((state) => state.present.features);

  const boundary = draftPolygon(draft);
  const zones = selectZones({ present: draft });
  // Not `draft.selectedZoneIds`: moving the house can dissolve a zone whose tick survives, and
  // neither the picture nor the line beneath it should claim an area that no longer exists.
  const chosenZoneIds = effectiveZoneIds(draft, zones);
  const summary = summariseFeatures(features);

  return (
    <section
      data-testid="brief-context"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-garden-line bg-white px-3 py-2.5"
    >
      {/*
        Only when there is a plot to draw. `PropertyThumbnail`'s empty state is a full-width
        dashed panel saying "map your outdoor space in step 1", which is right in a sidebar and
        wrong in a 64 px slot — it wrapped onto seven lines and made the strip taller than the
        card it sits above. The line beside it already says no areas are chosen, so nothing is
        lost by leaving the picture out until there is one.
      */}
      {boundary.length >= 3 ? (
        <span className="w-16 shrink-0">
          <PropertyThumbnail
            boundary={boundary}
            house={draft.house}
            zones={zones}
            selectedZoneIds={chosenZoneIds}
          />
        </span>
      ) : null}

      <span className="min-w-0">
        <span className="block text-[10px] tracking-wide text-garden-muted uppercase">
          Designing
        </span>
        <span data-testid="context-zones" className="block text-xs font-medium text-garden-ink">
          {zoneScopeLabel(zones, chosenZoneIds)}
        </span>
      </span>

      <span className="min-w-0">
        <span className="block text-[10px] tracking-wide text-garden-muted uppercase">
          Existing features
        </span>

        {summary.total === 0 ? (
          <span data-testid="context-features-empty" className="block text-xs text-garden-muted">
            None mapped
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="context-features-total" className="sr-only">
              {summary.total} placed
            </span>

            {STATUS_ORDER.map((status) => {
              const style = STATUS_COLOURS[status];
              const Icon = STATUS_ICONS[status];

              return (
                <span key={status} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    style={{ background: style.tint, color: style.stroke }}
                    className="flex h-4 w-4 items-center justify-center rounded-full"
                  >
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                  <span
                    data-testid={`context-${status}`}
                    className="text-xs font-semibold text-garden-ink"
                  >
                    {summary[status]}
                  </span>
                  <span className="text-xs text-garden-muted">{style.label}</span>
                </span>
              );
            })}
          </span>
        )}
      </span>

      <Link
        href={planHref('map')}
        data-testid="edit-previous-steps"
        className="ml-auto flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden className="h-3 w-3" />
        Edit previous steps
      </Link>
    </section>
  );
}
