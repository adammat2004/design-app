'use client';

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { SunNeed } from '@garden-studio/schema';
import {
  bySubgroup,
  CATALOGUE_CATEGORIES,
  HEIGHT_BANDS,
  passesFilter,
  SUN_LABELS,
  type CatalogueCategory,
  type CatalogueEntry,
  type HeightBand,
  type PlantFilter,
} from '@/lib/catalogue';
import { CatalogueTile } from './CatalogueTile';

/** A category with at most this many things shows every subgroup open; a bigger one opens the first. */
const OPEN_ALL_UP_TO = 16;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export interface TileProps {
  detail: (entry: CatalogueEntry) => string;
  isActive: (entry: CatalogueEntry) => boolean;
  onChoose: (entry: CatalogueEntry) => void;
}

/** A two-column grid of tiles. Shared by the category panel, the search results and Recent. */
export function TileGrid({ entries, ...tile }: { entries: CatalogueEntry[] } & TileProps) {
  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <CatalogueTile entry={entry} detail={tile.detail(entry)} active={tile.isActive(entry)} onChoose={tile.onChoose} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One category: its name, the plant filters where it has them, and its subgroups, each folding away
 * so a long one — twenty-odd shrubs — does not bury the next.
 */
export function CataloguePanel({
  category,
  entries,
  filter,
  onFilter,
  ...tile
}: {
  category: CatalogueCategory;
  entries: CatalogueEntry[];
  filter: PlantFilter;
  onFilter: (filter: PlantFilter) => void;
} & TileProps) {
  const spec = CATALOGUE_CATEGORIES.find((candidate) => candidate.id === category)!;
  const inCategory = entries.filter((entry) => entry.category === category);
  const shown = inCategory.filter((entry) => passesFilter(entry, filter));
  const groups = bySubgroup(shown, category);
  const openAll = inCategory.length <= OPEN_ALL_UP_TO;

  /* Which subgroups the user has folded or unfolded, against the default for this category. */
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (subgroup: string, index: number) => {
    const byDefault = openAll || index === 0;
    return toggled.has(`${category}:${subgroup}`) ? !byDefault : byDefault;
  };
  const toggle = (subgroup: string) =>
    setToggled((current) => {
      const next = new Set(current);
      const key = `${category}:${subgroup}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div data-testid={`catalogue-panel-${category}`} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-garden-ink">{spec.label}</h3>
        <span className="text-[11px] tabular-nums text-garden-muted">{shown.length}</span>
      </div>

      {category === 'plants' ? <PlantFilters filter={filter} onFilter={onFilter} /> : null}

      {groups.length === 0 ? (
        <p data-testid="palette-empty" className="py-4 text-xs text-garden-muted">
          No plant fits all of those. Loosen a filter.
        </p>
      ) : null}

      {groups.map((group, index) => {
        const open = isOpen(group.subgroup, index);
        const showHeading = spec.subgroups.length > 1;
        return (
          <section key={group.subgroup}>
            {showHeading ? (
              <button
                type="button"
                data-testid={`catalogue-subgroup-${slug(group.subgroup)}`}
                aria-expanded={open}
                onClick={() => toggle(group.subgroup)}
                className="mb-1.5 flex w-full items-center gap-1 rounded text-left text-[11px] font-semibold tracking-wide text-garden-muted uppercase hover:text-garden-ink focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
              >
                <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                {group.subgroup}
                <span className="ml-auto font-normal tabular-nums normal-case">{group.entries.length}</span>
              </button>
            ) : null}
            {open ? <TileGrid entries={group.entries} {...tile} /> : null}
          </section>
        );
      })}
    </div>
  );
}

/** What the place asks of a plant: the light it gets, whether it must look the same in January, how tall. */
function PlantFilters({ filter, onFilter }: { filter: PlantFilter; onFilter: (filter: PlantFilter) => void }) {
  const select =
    'min-w-0 rounded-md border border-garden-line bg-white px-1.5 py-1 text-[11px] text-garden-ink focus-visible:border-garden-green focus-visible:outline-none';
  return (
    <div data-testid="plant-filters" className="grid grid-cols-2 gap-1.5">
      <select
        aria-label="Light"
        data-testid="plant-filter-sun"
        value={filter.sun}
        onChange={(event) => onFilter({ ...filter, sun: event.target.value as SunNeed | 'any' })}
        className={select}
      >
        {(Object.keys(SUN_LABELS) as (keyof typeof SUN_LABELS)[]).map((sun) => (
          <option key={sun} value={sun}>
            {SUN_LABELS[sun]}
          </option>
        ))}
      </select>
      <select
        aria-label="Mature height"
        data-testid="plant-filter-height"
        value={filter.height}
        onChange={(event) => onFilter({ ...filter, height: event.target.value as HeightBand })}
        className={select}
      >
        {(Object.keys(HEIGHT_BANDS) as HeightBand[]).map((band) => (
          <option key={band} value={band}>
            {HEIGHT_BANDS[band].label}
          </option>
        ))}
      </select>
      <label className="col-span-2 flex items-center gap-2 text-[11px] text-garden-ink">
        <input
          type="checkbox"
          data-testid="plant-filter-evergreen"
          checked={filter.evergreen}
          onChange={(event) => onFilter({ ...filter, evergreen: event.target.checked })}
          className="accent-garden-green"
        />
        Evergreen only
      </label>
    </div>
  );
}
