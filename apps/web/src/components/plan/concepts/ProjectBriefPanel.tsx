'use client';

import Link from 'next/link';
import { SquarePen } from 'lucide-react';
import { zoneScopeLabel } from '@/lib/brief';
import { STATUS_COLOURS, STATUS_ORDER } from '@/lib/feature-colours';
import { summariseFeatures } from '@/lib/features';
import { effectiveZoneIds, selectZones, useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';
import { usePlanHref } from '../ProjectContext';

/**
 * What the concepts were generated from, in one read-only card.
 *
 * The same recap `brief/ContextPanel.tsx` shows on step 3, trimmed to what matters once the
 * plans are on screen. It exists so the user can sanity-check a concept against their own
 * inputs without walking back three steps — and everything in it is derived, so it cannot drift
 * from what the generator was actually given.
 */
export function ProjectBriefPanel() {
  const planHref = usePlanHref();
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const features = useFeaturesStore((state) => state.present.features);

  const zones = selectZones({ present: boundaryDraft });
  const scope = zoneScopeLabel(zones, effectiveZoneIds(boundaryDraft, zones));
  const summary = summariseFeatures(features);

  return (
    <section
      data-testid="project-brief"
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="text-xs font-semibold text-garden-ink">
        Project brief
        <span className="ml-1 font-normal text-garden-muted">(from previous steps)</span>
      </h2>

      <div className="mt-2.5">
        <p className="text-[10px] font-medium text-garden-muted">Design areas</p>
        <p data-testid="brief-zones" className="text-[11px] text-garden-ink">
          {scope}
        </p>
      </div>

      <dl className="mt-2.5 space-y-1 border-t border-garden-line pt-2.5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-center justify-between gap-2 text-[11px]">
            <dt className="flex items-center gap-1.5 text-garden-muted">
              <span
                aria-hidden
                style={{ background: STATUS_COLOURS[status].stroke }}
                className="inline-block h-1.5 w-1.5 rounded-full"
              />
              Features to {status}
            </dt>
            <dd
              data-testid={`brief-${status}`}
              className="font-semibold text-garden-ink tabular-nums"
            >
              {summary[status]}
            </dd>
          </div>
        ))}
      </dl>

      <Link
        href={planHref('brief')}
        data-testid="edit-previous-steps"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-garden-line bg-white px-3 py-1.5 text-[11px] font-medium text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
      >
        <SquarePen aria-hidden className="h-3 w-3" />
        Edit previous steps
      </Link>
    </section>
  );
}
