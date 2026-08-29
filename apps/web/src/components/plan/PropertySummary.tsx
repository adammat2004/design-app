'use client';

import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { houseArea } from '@/lib/house';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { LegendSwatch } from './LegendPanel';

/** Every number here is computed off the actual shapes, so it cannot drift out of date. */
export function PropertySummary() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  const total = polygonArea(draftPolygon(draft));
  const footprint = houseArea(draft.house);
  const usable = Math.max(0, total - footprint);

  return (
    <section className="space-y-2 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">Mapping summary</h2>

      <dl data-testid="property-summary" className="space-y-2 text-xs">
        <Row
          testId="summary-total"
          swatch="boundary"
          label="Total property"
          value={formatArea(total, unit)}
        />
        <Row
          testId="summary-house"
          swatch="house"
          label="House footprint"
          value={draft.house ? formatArea(footprint, unit) : '—'}
        />
        <Row
          testId="summary-usable"
          swatch="garden"
          label="Usable outdoor area"
          value={formatArea(usable, unit)}
        />
      </dl>
    </section>
  );
}

function Row({
  testId,
  swatch,
  label,
  value,
}: {
  testId: string;
  swatch: 'boundary' | 'house' | 'garden';
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* The same swatches as the legend, so the two panels read as one vocabulary. */}
      <LegendSwatch kind={swatch} />
      <dt className="flex-1 text-garden-muted">{label}</dt>
      <dd data-testid={testId} className="font-medium text-garden-ink">
        {value}
      </dd>
    </div>
  );
}
