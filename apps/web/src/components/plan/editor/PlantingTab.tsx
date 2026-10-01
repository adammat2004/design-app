'use client';

import { Sun, X } from 'lucide-react';
import {
  bedExposure,
  bedMix,
  elementArea,
  isPlantingMix,
  materialLabel,
  mixCounts,
  mixMaintenance,
  presetMatching,
  PLANT_SPECIES,
  PLANTING_MIXES,
  PLANTING_MIX_IDS,
  speciesById,
  unsuitedTo,
  withoutSpecies,
  withShare,
  withSpecies,
  type DesignElement,
  type MixEntry,
  type SunNeed,
} from '@garden-studio/schema';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { Caption } from './Pill';
import { inputClass, Row } from './SelectedElementPanel';

/** What a bed may be planted with by hand: everything but trees and hedging, which are placed or run. */
const BED_SPECIES = PLANT_SPECIES.filter((species) => species.form !== 'tree' && species.form !== 'hedge').sort(
  (a, b) => a.common.localeCompare(b.common),
);

const LIGHT_LABELS: Record<SunNeed, string> = {
  full: 'Full sun',
  part: 'Part shade',
  shade: 'Shade',
};

const CUSTOM = 'custom';

/**
 * What a bed is planted with: a named mix or one of its own, the plants that comes to, and whether
 * the place suits them.
 *
 * Every number here is derived as it is read. The counts are `mixCounts` of the bed's area at each
 * species' own centres, so dragging the bed bigger changes the order; the light is `bedExposure`
 * against the plan as it stands, so moving the garden room changes the verdict. Nothing is stored
 * but the mix.
 *
 * **Editing a share makes the mix the bed's own.** Its material still names the mix it started from,
 * and "Back to …" drops the bed's copy — one tap, and the undo stack holds every step between.
 */
export function PlantingTab({ element }: { element: DesignElement }) {
  const store = usePlanEditorStore.getState;
  const elements = usePlanEditorStore((state) => state.present.elements);
  const site = useBoundaryStore((state) => state.present);

  const mix = bedMix(element);
  /* A bed's own mix that is a copy of a preset — as the generator plants one — is that preset. */
  const copied = element.planting ? presetMatching(element.planting.mix) : null;
  const custom = Boolean(element.planting) && !copied;
  const area = elementArea(element);
  const lines = mix ? mixCounts(mix, area) : [];
  const total = lines.reduce((sum, line) => sum + line.count, 0);

  const exposure = bedExposure(site, element, elements);
  const struggling = mix && exposure ? unsuitedTo(mix, exposure.light) : [];

  const setMix = (next: MixEntry[]) => store().setPlanting(element.id, { mix: next });
  const baseMix = copied ?? (isPlantingMix(element.material) ? PLANTING_MIXES[element.material!] : undefined);

  return (
    <div data-testid="planting-tab" className="space-y-3">
      <Row label="Mix">
        <select
          data-testid="planting-mix"
          aria-label="Planting mix"
          className={inputClass}
          value={custom ? CUSTOM : (baseMix?.id ?? '')}
          onChange={(event) => {
            if (event.target.value === CUSTOM) return;
            store().setMaterial(element.id, event.target.value);
          }}
        >
          {!mix ? (
            <option value="" disabled>
              No species — drawn as {materialLabel(element.material ?? 'mixed-border')}
            </option>
          ) : null}
          {custom ? <option value={CUSTOM}>Its own mix</option> : null}
          {PLANTING_MIX_IDS.map((id) => (
            <option key={id} value={id}>
              {PLANTING_MIXES[id]!.label}
            </option>
          ))}
        </select>
      </Row>

      {baseMix && !custom ? (
        <p className="text-[11px] leading-relaxed text-garden-muted">{baseMix.suits}</p>
      ) : null}
      {custom && baseMix ? (
        <button
          type="button"
          data-testid="planting-reset"
          onClick={() => store().setPlanting(element.id, undefined)}
          className="text-[11px] text-garden-forest underline underline-offset-2 hover:text-garden-green"
        >
          Back to the {baseMix.label.toLowerCase()}
        </button>
      ) : null}

      <LightVerdict
        located={Boolean(site.location)}
        exposure={exposure}
        struggling={struggling.map((entry) => speciesById(entry.speciesId)!.common)}
        of={lines.length}
      />

      {mix ? (
        <div>
          <div className="flex items-baseline justify-between">
            <Caption>Plants</Caption>
            <span data-testid="planting-total" className="text-[11px] tabular-nums text-garden-muted">
              {total.toLocaleString('en-GB')} to order · {mixMaintenance(mix)} upkeep
            </span>
          </div>
          <ul className="mt-1 space-y-1">
            {lines.map((line) => (
              <li
                key={line.species.id}
                data-testid={`planting-line-${line.species.id}`}
                className="flex items-center gap-2 text-xs text-garden-ink"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{line.species.common}</span>
                  <span className="block truncate text-[10px] text-garden-muted italic">{line.species.botanical}</span>
                </span>
                <ShareInput
                  speciesId={line.species.id}
                  share={line.share}
                  onCommit={(share) => setMix(withShare(mix, line.species.id, share))}
                />
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-garden-muted" title="Plants to order">
                  {line.count}
                </span>
                <button
                  type="button"
                  data-testid={`planting-remove-${line.species.id}`}
                  aria-label={`Take ${line.species.common} out of the mix`}
                  disabled={lines.length <= 1}
                  onClick={() => setMix(withoutSpecies(mix, line.species.id))}
                  className="rounded p-0.5 text-garden-muted hover:bg-garden-sage hover:text-garden-ink disabled:opacity-30"
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Row label="Add">
        <select
          data-testid="planting-add"
          aria-label="Add a species to the mix"
          className={inputClass}
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (!id) return;
            setMix(mix ? withSpecies(mix, id) : [{ speciesId: id, share: 1 }]);
          }}
        >
          <option value="">Add a plant…</option>
          {BED_SPECIES.filter((species) => !mix?.some((entry) => entry.speciesId === species.id)).map((species) => (
            <option key={species.id} value={species.id}>
              {species.common}
            </option>
          ))}
        </select>
      </Row>
    </div>
  );
}

/**
 * Whether the place suits the planting. Absent as a claim without a location — no latitude is true
 * of anywhere — but the reason is given, because a panel that silently lacks a check reads as a
 * panel that passed it.
 */
function LightVerdict({
  located,
  exposure,
  struggling,
  of,
}: {
  located: boolean;
  exposure: { hours: number; light: SunNeed } | null;
  struggling: string[];
  of: number;
}) {
  if (!located || !exposure) {
    return (
      <p data-testid="planting-light-unknown" className="text-[11px] leading-relaxed text-garden-muted">
        Set where the garden is on step 1 and this will say how much sun the bed gets.
      </p>
    );
  }

  const suits = struggling.length === 0;
  return (
    <div
      data-testid="planting-light"
      data-suits={suits}
      className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed ${
        suits ? 'bg-garden-sage text-garden-ink' : 'bg-amber-50 text-amber-900'
      }`}
    >
      <Sun aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-medium">{LIGHT_LABELS[exposure.light]}</span>, about{' '}
        {exposure.hours.toFixed(1)} h of direct sun a day through the season.{' '}
        {suits
          ? of > 0
            ? 'Everything in the mix suits it.'
            : null
          : `${struggling.length} of ${of} will struggle here: ${struggling.join(', ')}.`}
      </span>
    </div>
  );
}

/** A share as a whole percentage, committed on Enter or blur like every typed field in the sheet. */
function ShareInput({
  speciesId,
  share,
  onCommit,
}: {
  speciesId: string;
  share: number;
  onCommit: (share: number) => void;
}) {
  const percent = Math.round(share * 100);
  return (
    <span className="flex w-14 shrink-0 items-center gap-0.5 rounded-md border border-garden-line bg-white px-1.5 py-0.5 focus-within:border-garden-green">
      <input
        key={percent}
        type="number"
        inputMode="numeric"
        min={5}
        max={95}
        aria-label="Share of the bed"
        data-testid={`planting-share-${speciesId}`}
        defaultValue={percent}
        onBlur={(event) => {
          const typed = Number(event.target.value);
          if (Number.isFinite(typed) && Math.round(typed) !== percent) onCommit(typed / 100);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        className="w-full min-w-0 bg-transparent text-right text-[11px] tabular-nums text-garden-ink focus-visible:outline-none"
      />
      <span className="shrink-0 text-[10px] text-garden-muted">%</span>
    </span>
  );
}
