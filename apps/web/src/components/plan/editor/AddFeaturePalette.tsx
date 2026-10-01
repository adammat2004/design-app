'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { SymbolId } from '@garden-studio/schema';
import {
  CATALOGUE_CATEGORIES,
  catalogueEntries,
  detailFor,
  matchesSearch,
  NO_PLANT_FILTER,
  type CatalogueEntry,
  type PlantFilter,
} from '@/lib/catalogue';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { CatalogueRail, RAIL_CHOICES, railLabel, type RailChoice } from './catalogue/CatalogueRail';
import { CataloguePanel, TileGrid, type TileProps } from './catalogue/CataloguePanel';
import { useRecent, useStoredChoice } from './catalogue/useRecent';

/** Built once: the catalogue is a fact about the product, not about the plan. */
const ENTRIES = catalogueEntries();

/**
 * What can be put on the plan: a rail of categories and one category at a time.
 *
 * It was one catalogue — eighty-odd tiles three to a row under nine chips that wrapped onto three
 * lines — which is a list to scroll rather than a toolbox to reach into. The rail keeps every
 * category one click away and only one on screen; search is the way across all of them at once, and
 * Recent is the way back to what was just used. Choosing a tile arms the placement exactly as it
 * always did: `setPlacing` for a surface, a symbol or a species, `setPlacingEnclosure` for a line.
 */
export function AddFeaturePalette() {
  const unit = useBoundaryStore((state) => state.unit);
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const placingPlantId = usePlanEditorStore((state) => state.placingPlantId);
  const placingSymbol = usePlanEditorStore((state) => state.placingSymbol);
  const placingEnclosure = usePlanEditorStore((state) => state.placingEnclosure);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);
  const setPlacingEnclosure = usePlanEditorStore((state) => state.setPlacingEnclosure);

  const [search, setSearch] = useState('');
  const [choice, setChoice] = useStoredChoice<RailChoice>(RAIL_CHOICES, 'surfaces');
  const [filter, setFilter] = useState<PlantFilter>(NO_PLANT_FILTER);
  const { recent, remember } = useRecent();

  const isActive = (entry: CatalogueEntry) => {
    const arm = entry.arm;
    if (arm.kind === 'enclosure') return placingEnclosure === arm.enclosure;
    if (arm.plantId) return placingPlantId === arm.plantId;
    if (arm.symbol) return !placingPlantId && placingSymbol === arm.symbol;
    return placingCategory === arm.category && placingSymbol === null && placingEnclosure === null;
  };

  const choose = (entry: CatalogueEntry) => {
    const arm = entry.arm;
    if (isActive(entry)) {
      if (arm.kind === 'enclosure') setPlacingEnclosure(null);
      else setPlacing(null, null, null);
      return;
    }
    remember(entry.id);
    if (arm.kind === 'enclosure') setPlacingEnclosure(arm.enclosure);
    else setPlacing(arm.category, arm.symbol ?? null, arm.plantId ?? null);
  };

  const tile: TileProps = { detail: (entry) => detailFor(entry, unit), isActive, onChoose: choose };
  const searching = search.trim() !== '';
  const found = searching ? ENTRIES.filter((entry) => matchesSearch(entry, search)) : [];

  return (
    <section aria-label="Add features to the garden" className="flex h-full min-h-0 flex-col lg:flex-row">
      <CatalogueRail
        active={searching ? null : choice}
        onChoose={(next) => {
          setSearch('');
          setChoice(next);
        }}
      />

      <div data-testid="editor-palette" className="min-w-0 flex-1 space-y-3 overflow-y-auto p-3">
        <label className="relative block">
          <Search aria-hidden className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-garden-muted" />
          {/* Text rather than `search`: the browser's own clear button would sit beside this one. */}
          <input
            type="text"
            role="searchbox"
            aria-label="Search the catalogue"
            data-testid="palette-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search everything…"
            className="w-full rounded-lg border border-garden-line bg-white py-2 pr-7 pl-8 text-xs focus-visible:outline-2 focus-visible:outline-garden-green"
          />
          {searching ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setSearch('')}
              className="absolute top-2 right-2 rounded p-0.5 text-garden-muted hover:text-garden-ink"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>

        {searching ? (
          <SearchResults entries={found} query={search} tile={tile} />
        ) : choice === 'recent' ? (
          <div data-testid="catalogue-panel-recent" className="space-y-3">
            <h3 className="text-sm font-semibold text-garden-ink">{railLabel('recent')}</h3>
            {recent.length === 0 ? (
              <p className="text-xs leading-5 text-garden-muted">Things you place will gather here.</p>
            ) : (
              <TileGrid
                entries={recent
                  .map((id) => ENTRIES.find((entry) => entry.id === id))
                  .filter((entry): entry is CatalogueEntry => !!entry)}
                {...tile}
              />
            )}
          </div>
        ) : (
          <CataloguePanel category={choice} entries={ENTRIES} filter={filter} onFilter={setFilter} {...tile} />
        )}

        <p className="text-[11px] leading-5 text-garden-muted">
          Choose one, then click the plan to place it. Hold Shift to place several.
        </p>
      </div>
    </section>
  );
}

/** Everything that answers the search, headed by category so a result still says where it lives. */
function SearchResults({ entries, query, tile }: { entries: CatalogueEntry[]; query: string; tile: TileProps }) {
  if (entries.length === 0) {
    return (
      <p data-testid="palette-empty" className="py-4 text-xs text-garden-muted">
        Nothing matches “{query}”.
      </p>
    );
  }
  return (
    <div data-testid="catalogue-search-results" className="space-y-4">
      {CATALOGUE_CATEGORIES.map((spec) => {
        const inCategory = entries.filter((entry) => entry.category === spec.id);
        if (inCategory.length === 0) return null;
        return (
          <section key={spec.id}>
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-garden-muted uppercase">{spec.label}</h3>
            <TileGrid entries={inCategory} {...tile} />
          </section>
        );
      })}
    </div>
  );
}

export type { SymbolId };
