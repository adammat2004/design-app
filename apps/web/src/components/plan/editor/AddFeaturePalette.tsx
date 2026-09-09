'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { ADDABLE_SYMBOLS, PLANT_CATALOGUE, SYMBOLS, type SymbolId } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import type { ElementCategory } from '@/lib/concepts';
import { ADDABLE_CATEGORIES } from '@/lib/element-groups';
import { defaultMaterial } from '@/lib/materials';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { CatalogueThumbnail } from './CatalogueThumbnail';

const GROUPS = ['all', 'structures', 'surfaces', 'planting', 'furniture', 'features'] as const;
type GroupId = (typeof GROUPS)[number];
const GROUP_LABELS: Record<GroupId, string> = {
  all: 'All',
  structures: 'Structures',
  surfaces: 'Surfaces',
  planting: 'Planting',
  furniture: 'Furniture',
  features: 'Features',
};
const groupFor = (category: ElementCategory, symbol?: SymbolId): GroupId => {
  if (
    symbol &&
    ['fire-pit', 'planter', 'swing', 'slide', 'trampoline', 'raised-bed'].includes(symbol)
  )
    return 'features';
  if (category === 'structure') return 'structures';
  if (category === 'planting-bed' || category === 'lawn') return 'planting';
  if (category === 'furniture') return 'furniture';
  if (category === 'water-feature') return 'features';
  return 'surfaces';
};
const tidy = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function AddFeaturePalette() {
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const placingPlantId = usePlanEditorStore((state) => state.placingPlantId);
  const placingSymbol = usePlanEditorStore((state) => state.placingSymbol);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupId>('all');
  const entries: {
    id: string;
    label: string;
    category: ElementCategory;
    symbol?: SymbolId;
    plantId?: string;
  }[] = [
    ...ADDABLE_CATEGORIES.filter((category) => category !== 'furniture').map((category) => ({
      id: category,
      label: CATEGORY_COLOURS[category].label,
      category,
    })),
    ...ADDABLE_SYMBOLS.map((symbol) => ({
      id: symbol,
      label: SYMBOLS[symbol].label,
      category: SYMBOLS[symbol].category,
      symbol,
    })),
    ...Object.entries(PLANT_CATALOGUE).map(([plantId, plant]) => ({
      id: plantId,
      plantId,
      label: plant.name,
      category: 'planting-bed' as const,
      symbol: plant.symbol,
    })),
  ];
  const shown = entries.filter(
    (entry) =>
      (group === 'all' || groupFor(entry.category, entry.symbol) === group) &&
      tidy(entry.label).includes(tidy(search)),
  );
  return (
    <section aria-label="Add features to the garden">
      <label className="relative block">
        <Search aria-hidden className="absolute top-3 left-3 h-4 w-4 text-garden-muted" />
        <input
          type="search"
          aria-label="Search features"
          data-testid="palette-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search features…"
          className="w-full rounded-lg border border-garden-line bg-white py-2.5 pr-3 pl-9 text-xs focus-visible:outline-2 focus-visible:outline-garden-green"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {GROUPS.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`palette-group-${option}`}
            aria-pressed={option === group}
            onClick={() => setGroup(option)}
            className={`rounded-md border px-3 py-2 text-[11px] ${group === option ? 'border-garden-forest bg-garden-forest text-white' : 'border-garden-line bg-[#f5f6f8] text-garden-ink hover:bg-garden-sage'}`}
          >
            {GROUP_LABELS[option]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p data-testid="palette-empty" className="py-6 text-xs text-garden-muted">
          Nothing matches “{search}”.
        </p>
      ) : null}
      <div data-testid="editor-palette" className="space-y-6 py-5">
        {GROUPS.filter((section) => section !== 'all').map((section) => {
          const items = shown.filter((entry) => groupFor(entry.category, entry.symbol) === section);
          if (!items.length) return null;
          return (
            <div key={section}>
              <h3 className="mb-2 text-sm font-semibold text-garden-ink">
                {GROUP_LABELS[section]}
              </h3>
              <ul className="grid grid-cols-3 gap-2">
                {items.map((entry) => {
                  const active = entry.plantId
                    ? placingPlantId === entry.plantId
                    : entry.symbol
                      ? !placingPlantId && placingSymbol === entry.symbol
                      : placingCategory === entry.category && placingSymbol === null;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        data-testid={`palette-${entry.id}`}
                        aria-pressed={active}
                        title="Choose, then click the plan to place"
                        onClick={() =>
                          setPlacing(
                            active ? null : entry.category,
                            active ? null : entry.symbol,
                            active ? null : entry.plantId,
                          )
                        }
                        className={`flex h-full min-h-24 w-full flex-col items-center rounded-lg border p-1.5 transition hover:border-garden-green focus-visible:outline-2 focus-visible:outline-garden-green ${active ? 'border-garden-green bg-garden-sage' : 'border-garden-line bg-white'}`}
                      >
                        <span className="block h-16 w-full rounded bg-[#fafbf9] p-1">
                          <CatalogueThumbnail
                            element={{ ...entry, material: defaultMaterial(entry.category) }}
                          />
                        </span>
                        <span className="mt-1.5 text-[10px] leading-4 text-garden-ink">
                          {entry.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-5 text-garden-muted">
        Choose a feature, then click the plan to place it.
      </p>
    </section>
  );
}
export type { SymbolId };
