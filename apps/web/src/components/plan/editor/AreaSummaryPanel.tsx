'use client';

import { polygonArea } from '@/lib/boundary-geometry';
import { areaSummary } from '@/lib/element-groups';
import { formatArea } from '@/lib/units';
import { draftPolygon } from '@/lib/boundary-geometry';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * How the plan divides up, recomputed on every change.
 *
 * Derived at render rather than stored, so it cannot drift from the layout it describes — the
 * same discipline `selectZones` follows on step 1.
 *
 * The shares are percentages of the planned surfaces, not of the site. A concept stacks features
 * on ground cover by design, so the footprints overlap and shares against the site would run past
 * 100% and read as a bug. Site area gets its own row instead, which says both things honestly.
 */
export function AreaSummaryPanel() {
  const elements = usePlanEditorStore((state) => state.present.elements);
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  const siteArea = polygonArea(draftPolygon(boundaryDraft));
  const summary = areaSummary(elements, siteArea);

  return (
    <section data-testid="area-summary">
      <h2 className="text-xs font-semibold text-garden-ink">Area summary</h2>

      <div className="mt-2 flex items-baseline justify-between gap-2 rounded-lg bg-garden-sage/50 px-2.5 py-1.5">
        <span className="text-[11px] text-garden-muted">Total site area</span>
        <span
          data-testid="summary-site-area"
          className="text-sm font-semibold text-garden-ink tabular-nums"
        >
          {formatArea(summary.siteArea, unit)}
        </span>
      </div>

      <ul className="mt-2 space-y-2">
        {summary.groups.map((group) => (
          <li key={group.group} data-testid={`summary-${group.group}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-garden-muted">{group.label}</span>
              <span className="text-garden-ink tabular-nums">
                {formatArea(group.area, unit)}
                <span className="ml-1.5 text-garden-muted">{group.share.toFixed(0)}%</span>
              </span>
            </div>

            {/* A bar rather than a pie: three values, read left to right, no legend needed. */}
            <span
              aria-hidden
              className="mt-1 block h-1.5 overflow-hidden rounded-full bg-garden-line"
            >
              <span
                className="block h-full rounded-full bg-garden-green"
                style={{ width: `${group.share}%` }}
              />
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-garden-muted">
        Shares are of planned surfaces ({formatArea(summary.planned, unit)}), which overlap where
        features sit on ground cover.
      </p>
    </section>
  );
}
