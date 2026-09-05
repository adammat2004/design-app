'use client';

import { useState } from 'react';

import { ADDABLE_SYMBOLS, SYMBOLS, type SymbolId } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import type { ElementCategory } from '@/lib/concepts';
import { ADDABLE_CATEGORIES } from '@/lib/element-groups';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { EditorIcon } from './EditorIcon';

/**
 * The palette that adds a new surface or a piece of furniture to the plan.
 *
 * Same shape as step 2's `FeatureTypePalette`: pick a type, then click the canvas. Clicking the
 * active type again cancels, so there is no way to get stuck in placing mode without a visible
 * way out.
 *
 * Surfaces are offered by category; furniture by *symbol*, because "furniture" is not a thing
 * anyone places — a dining set or a lounger is, and each brings its own footprint.
 *
 * `existing-feature` is deliberately not offered — that category means "carried over from step 2",
 * and letting the user create one here would make the word a lie.
 */
/**
 * The groups the filter offers, and what falls in each.
 *
 * Coarser than `ElementCategory` on purpose. A user looking for somewhere to sit does not think
 * "furniture, category of eight"; they think "seating". These are the words on the tabs in the
 * design the palette is being brought towards, and they map onto categories rather than replacing
 * them — the thing placed is still an `ElementCategory` and a `SymbolId`.
 */
const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'structures', label: 'Structures' },
  { id: 'planting', label: 'Planting' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'furniture', label: 'Furniture' },
] as const;

type GroupId = (typeof GROUPS)[number]['id'];

const CATEGORY_GROUP: Partial<Record<ElementCategory, GroupId>> = {
  structure: 'structures',
  'planting-bed': 'planting',
  lawn: 'planting',
  'paved-area': 'surfaces',
  'gravel-mulch': 'surfaces',
  'water-feature': 'surfaces',
  furniture: 'furniture',
};

/** Case- and punctuation-insensitive, so "firepit" finds "Fire pit". */
function matchesSearch(label: string, search: string): boolean {
  const tidy = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return tidy(label).includes(tidy(search));
}

export function AddFeaturePalette() {
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const placingSymbol = usePlanEditorStore((state) => state.placingSymbol);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupId>('all');

  const inGroup = (category: ElementCategory) =>
    group === 'all' || CATEGORY_GROUP[category] === group;

  const surfaces = ADDABLE_CATEGORIES.filter(
    (category) =>
      category !== 'furniture' &&
      inGroup(category) &&
      matchesSearch(CATEGORY_COLOURS[category].label, search),
  );

  const furniture = ADDABLE_SYMBOLS.filter(
    (symbol) => inGroup(SYMBOLS[symbol].category) && matchesSearch(SYMBOLS[symbol].label, search),
  );

  const nothing = surfaces.length === 0 && furniture.length === 0;

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Add features</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
        Choose a surface, then click the plan to place it.
      </p>

      {/*
        Search and a group filter.

        The palette is twenty things today and heading for many more as the asset library grows —
        which is the point of the Phase D taxonomy. A grid you have to scan is fine at twenty and
        useless at eighty, and the cheapest time to add the control is before it is needed.
      */}
      <label className="mt-3 block">
        <span className="sr-only">Search features</span>
        <input
          type="search"
          data-testid="palette-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search features…"
          className="w-full rounded-lg border border-garden-line bg-white px-2.5 py-1.5 text-xs text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-green focus-visible:outline-none"
        />
      </label>

      <ul className="mt-2 flex flex-wrap gap-1">
        {GROUPS.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              data-testid={`palette-group-${option.id}`}
              aria-pressed={group === option.id}
              onClick={() => setGroup(option.id)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                group === option.id
                  ? 'bg-garden-forest text-white'
                  : 'bg-garden-sage text-garden-forest hover:bg-garden-green hover:text-white'
              }`}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>

      {nothing ? (
        <p data-testid="palette-empty" className="mt-3 text-[11px] text-garden-muted">
          Nothing matches “{search}”.
        </p>
      ) : null}

      <ul data-testid="editor-palette" className="mt-3 grid grid-cols-3 gap-2">
        {surfaces.map((category) => (
          <li key={category}>
            <PaletteButton
              testId={`palette-${category}`}
              category={category}
              label={CATEGORY_COLOURS[category].label}
              active={placingCategory === category && placingSymbol === null}
              onClick={() =>
                setPlacing(placingCategory === category && placingSymbol === null ? null : category)
              }
            />
          </li>
        ))}
      </ul>

      {furniture.length > 0 ? (
        <>
          <h3 className="mt-4 text-xs font-semibold text-garden-ink">Furniture</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
            Stands on a patio, deck or lawn. Sized as the real thing.
          </p>
        </>
      ) : null}

      <ul data-testid="editor-furniture-palette" className="mt-3 grid grid-cols-3 gap-2">
        {furniture.map((symbol) => (
          <li key={symbol}>
            <PaletteButton
              testId={`palette-${symbol}`}
              category={SYMBOLS[symbol].category}
              label={SYMBOLS[symbol].label}
              active={placingSymbol === symbol}
              onClick={() =>
                placingSymbol === symbol
                  ? setPlacing(null)
                  : setPlacing(SYMBOLS[symbol].category, symbol)
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaletteButton({
  testId,
  category,
  label,
  active,
  onClick,
}: {
  testId: string;
  category: ElementCategory;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      title="Click the plan to place it"
      onClick={onClick}
      className={[
        'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        active
          ? 'border-garden-green bg-garden-sage text-garden-forest'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
      ].join(' ')}
    >
      <EditorIcon category={category} className="h-5 w-5" />
      <span className="text-[10px] leading-tight font-medium">{label}</span>
    </button>
  );
}

export type { SymbolId };
