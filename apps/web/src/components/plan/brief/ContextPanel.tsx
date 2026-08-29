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
 * Read-only by design — everything here is derived, nothing is a second copy. The features
 * tally comes from `summariseFeatures`, the same function step 2's own list uses, and the
 * colours come from `STATUS_COLOURS`, so the two screens agree by construction rather than by
 * matching hexes.
 */
export function ContextPanel() {
  const planHref = usePlanHref();
  const draft = useBoundaryStore((state) => state.present);
  const features = useFeaturesStore((state) => state.present.features);

  const zones = selectZones({ present: draft });
  // Not `draft.selectedZoneIds`: moving the house can dissolve a zone whose tick survives, and
  // neither the picture nor the line beneath it should claim an area that no longer exists.
  const chosenZoneIds = effectiveZoneIds(draft, zones);
  const summary = summariseFeatures(features);

  return (
    <section
      data-testid="brief-context"
      className="rounded-xl border border-garden-line bg-garden-sage/30 p-3"
    >
      <h2 className="text-xs font-semibold text-garden-ink">
        Context <span className="font-normal text-garden-muted">(read-only)</span>
      </h2>

      <div className="mt-3">
        <h3 className="text-[11px] font-semibold text-garden-ink">Design areas</h3>
        <div className="mt-1.5">
          <PropertyThumbnail
            boundary={draftPolygon(draft)}
            house={draft.house}
            zones={zones}
            selectedZoneIds={chosenZoneIds}
          />
        </div>
        <p data-testid="context-zones" className="mt-1.5 text-[11px] text-garden-muted">
          {zoneScopeLabel(zones, chosenZoneIds)}
        </p>
      </div>

      <div className="mt-3 border-t border-garden-line pt-3">
        <h3 className="text-[11px] font-semibold text-garden-ink">Existing features</h3>

        {summary.total === 0 ? (
          <p data-testid="context-features-empty" className="mt-1.5 text-[11px] text-garden-muted">
            No features mapped in step 2.
          </p>
        ) : (
          <>
            <p
              data-testid="context-features-total"
              className="mt-1.5 text-[11px] text-garden-muted"
            >
              <span className="font-semibold text-garden-ink">{summary.total}</span> placed
            </p>

            <ul data-testid="context-features" className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {STATUS_ORDER.map((status) => {
                const style = STATUS_COLOURS[status];
                const Icon = STATUS_ICONS[status];

                return (
                  <li key={status} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      style={{ background: style.tint, color: style.stroke }}
                      className="flex h-4 w-4 items-center justify-center rounded-full"
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <span
                      data-testid={`context-${status}`}
                      className="text-[11px] font-semibold text-garden-ink"
                    >
                      {summary[status]}
                    </span>
                    <span className="text-[11px] text-garden-muted">{style.label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Link
        href={planHref('map')}
        data-testid="edit-previous-steps"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-garden-line bg-white px-3 py-1.5 text-[11px] font-medium text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden className="h-3 w-3" />
        Edit previous steps
      </Link>
    </section>
  );
}
