'use client';

import { Check } from 'lucide-react';
import { formatArea } from '@/lib/units';
import { ZONE_COLOURS } from '@/lib/zone-colours';
import { sortZones } from '@/lib/zones';
import { selectZones, useBoundaryStore } from '@/state/boundary-store';

/** The design scope carried forward to steps 2 and 3 — which zones the user wants redesigned. */
export function DesignAreasPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const toggleZone = useBoundaryStore((state) => state.toggleZone);
  const toggleAllZones = useBoundaryStore((state) => state.toggleAllZones);

  const zones = sortZones(selectZones({ present: draft }));
  const allSelected =
    zones.length > 0 && zones.every((zone) => draft.selectedZoneIds.includes(zone.id));

  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Design areas</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
        Choose which outdoor areas you would like to redesign.
      </p>

      {zones.length === 0 ? (
        <p data-testid="design-areas-empty" className="mt-3 text-[11px] text-garden-muted">
          Place the house to work out which garden areas you have.
        </p>
      ) : (
        <ul data-testid="design-areas" className="mt-3 space-y-1">
          {zones.map((zone) => (
            <li key={zone.id}>
              <ZoneCheckbox
                testId={`design-area-${zone.id}`}
                label={zone.label}
                hint={formatArea(zone.area, unit)}
                swatch={ZONE_COLOURS[zone.id]}
                checked={draft.selectedZoneIds.includes(zone.id)}
                onChange={() => toggleZone(zone.id)}
              />
            </li>
          ))}
          <li className="border-t border-garden-line pt-1">
            <ZoneCheckbox
              testId="design-area-all"
              label="Entire outdoor space"
              swatch="var(--color-garden-sage)"
              checked={allSelected}
              onChange={toggleAllZones}
            />
          </li>
        </ul>
      )}
    </section>
  );
}

function ZoneCheckbox({
  testId,
  label,
  hint,
  swatch,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  hint?: string;
  swatch: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-garden-sage/60">
      <span
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          checked
            ? 'border-garden-green bg-garden-green text-white'
            : 'border-garden-line bg-white',
        ].join(' ')}
      >
        {checked ? <Check aria-hidden className="h-3 w-3" /> : null}
      </span>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="flex-1 text-xs text-garden-ink">{label}</span>
      {hint ? <span className="text-[10px] text-garden-muted">{hint}</span> : null}
      {/* The same colour this zone is tinted on the plan. */}
      <span
        aria-hidden
        style={{ background: swatch }}
        className="h-4 w-5 shrink-0 rounded border border-black/10"
      />
    </label>
  );
}
