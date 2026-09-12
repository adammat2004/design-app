'use client';

import { Check, CircleAlert, PencilLine, Trash2 } from 'lucide-react';
import {
  gardenDirection,
  openingCentre,
  pointInPolygon,
  primaryDoorTowards,
  type Point,
} from '@garden-studio/schema';
import { formatArea } from '@/lib/units';
import { ZONE_COLOURS } from '@/lib/zone-colours';
import { sortZones } from '@/lib/zones';
import { selectZones, useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';

/**
 * What the concept generator is allowed to change.
 *
 * This used to be `DesignAreasPanel` in step 2's right-hand column — a checkbox list captioned
 * "Design areas". It is promoted here because it is the other half of what this screen is *for*:
 * "what is already here" and "what may change" are the two questions the generator asks of step 2,
 * and burying one of them in a side column made it read as a setting rather than a decision.
 *
 * The zone ticks are unchanged and still live on the boundary store, under `site.selectedZoneIds`.
 * What is new is the custom outline beside them.
 */
export function RedesignAreaPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const toggleZone = useBoundaryStore((state) => state.toggleZone);
  const toggleAllZones = useBoundaryStore((state) => state.toggleAllZones);
  const setScopePolygon = useBoundaryStore((state) => state.setScopePolygon);

  const mode = useFeaturesStore((state) => state.mode);
  const startScopeDraw = useFeaturesStore((state) => state.startScopeDraw);
  const setMode = useFeaturesStore((state) => state.setMode);

  const zones = sortZones(selectZones({ present: draft }));
  const allSelected =
    zones.length > 0 && zones.every((zone) => draft.selectedZoneIds.includes(zone.id));

  const custom = draft.scopePolygon;
  const drawing = mode === 'scope';

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-garden-ink">Redesign area</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
          Choose what the design is allowed to change. Everything outside it is left exactly as it
          is.
        </p>
      </div>

      {zones.length === 0 ? (
        <p data-testid="design-areas-empty" className="text-[11px] text-garden-muted">
          Place the house to work out which garden areas you have.
        </p>
      ) : (
        <ul data-testid="design-areas" className="space-y-1">
          <li className="border-b border-garden-line pb-1">
            <ZoneRow
              testId="design-area-all"
              label="Entire garden"
              swatch="var(--color-garden-sage)"
              checked={allSelected && custom === null}
              onChange={() => {
                if (custom !== null) setScopePolygon(null);
                if (!allSelected) toggleAllZones();
              }}
            />
          </li>

          {zones.map((zone) => (
            <li key={zone.id}>
              <ZoneRow
                testId={`design-area-${zone.id}`}
                label={zone.label}
                hint={formatArea(zone.area, unit)}
                swatch={ZONE_COLOURS[zone.id]}
                checked={draft.selectedZoneIds.includes(zone.id)}
                onChange={() => toggleZone(zone.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        A custom outline narrows whichever zones are ticked; it does not replace them. That is how
        the generator reads it too — the zones say which gardens, the outline clips them.
      */}
      <div className="rounded-xl border border-dashed border-garden-line p-2.5">
        <p className="text-xs font-semibold text-garden-ink">Custom area</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-garden-muted">
          {custom
            ? 'Only the outline you drew will be redesigned.'
            : 'Draw an outline to narrow the redesign down to part of the garden.'}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="draw-scope"
            onClick={() => (drawing ? setMode('select') : startScopeDraw())}
            aria-pressed={drawing}
            className={[
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
              drawing
                ? 'border-garden-green bg-garden-sage text-garden-forest'
                : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
            ].join(' ')}
          >
            <PencilLine aria-hidden className="h-3 w-3" />
            {drawing ? 'Drawing — tap corners' : custom ? 'Redraw' : 'Draw area'}
          </button>

          {custom ? (
            <button
              type="button"
              data-testid="clear-scope"
              onClick={() => setScopePolygon(null)}
              className="flex items-center gap-1.5 rounded-full border border-garden-line bg-white px-2.5 py-1 text-[11px] font-medium text-garden-ink hover:border-garden-green hover:bg-garden-sage/50 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
            >
              <Trash2 aria-hidden className="h-3 w-3" />
              Clear
            </button>
          ) : null}
        </div>

        {custom ? <DoorWarning draft={draft} polygon={custom} /> : null}
      </div>
    </section>
  );
}

/**
 * The one warning worth making, because the cost is invisible until the concepts arrive.
 *
 * The generator composes a garden outwards from the door: the terrace sits across it, and every
 * path is anchored on the terrace. An area that does not reach the door therefore loses the
 * terrace *and* the paths, and the only sign is a sentence on the concept card three steps later.
 * Said here, while the outline is still on screen and easy to redraw.
 */
function DoorWarning({
  draft,
  polygon,
}: {
  draft: ReturnType<typeof useBoundaryStore.getState>['present'];
  polygon: Point[];
}) {
  const house = draft.house;
  if (!house) return null;

  const garden = gardenDirection(draft);
  const door = garden ? primaryDoorTowards(house, garden) : null;
  const centre = door ? openingCentre(house, door) : null;

  // No door to reason about is not a warning — plenty of plans have not placed one.
  if (!centre) return null;

  /*
   * A metre out from the wall, which is roughly where a terrace's first course lands. Testing the
   * door's own centre would sit exactly on the wall line and answer on a rounding error.
   */
  const probe = { x: centre.x + (garden?.x ?? 0), y: centre.y + (garden?.y ?? 0) };
  if (pointInPolygon(probe, polygon)) return null;

  return (
    <p
      data-testid="scope-misses-door"
      role="status"
      className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-900"
    >
      <CircleAlert aria-hidden className="mt-px h-3 w-3 shrink-0" />
      This area does not reach your garden doors, so the designs will not include a terrace there or
      the paths that lead from it.
    </p>
  );
}

function ZoneRow({
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
