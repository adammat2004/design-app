'use client';

import type { LucideIcon } from 'lucide-react';
import { Armchair, Droplets, Fence, Grid2x2, History, Lightbulb, Trees, Warehouse } from 'lucide-react';
import { CATALOGUE_CATEGORIES, type CatalogueCategory } from '@/lib/catalogue';

export type RailChoice = CatalogueCategory | 'recent';

const ICONS: Record<RailChoice, LucideIcon> = {
  surfaces: Grid2x2,
  plants: Trees,
  boundaries: Fence,
  structures: Warehouse,
  furniture: Armchair,
  lighting: Lightbulb,
  water: Droplets,
  recent: History,
};

export const RAIL_CHOICES: RailChoice[] = [...CATALOGUE_CATEGORIES.map((spec) => spec.id), 'recent'];

export function railLabel(choice: RailChoice): string {
  return choice === 'recent' ? 'Recently used' : CATALOGUE_CATEGORIES.find((spec) => spec.id === choice)!.label;
}

/**
 * The categories, one icon each, always in view. Down the left edge on a wide screen — the place a
 * design tool keeps its toolbox — and across the top when the sidebar is stacked above the plan.
 * A tab list: the arrow keys move between categories, and the label is the tooltip and the name.
 */
export function CatalogueRail({
  active,
  onChoose,
}: {
  active: RailChoice | null;
  onChoose: (choice: RailChoice) => void;
}) {
  const move = (from: RailChoice, step: number) => {
    const index = RAIL_CHOICES.indexOf(from);
    const next = RAIL_CHOICES[(index + step + RAIL_CHOICES.length) % RAIL_CHOICES.length]!;
    onChoose(next);
    document.getElementById(`catalogue-rail-${next}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Catalogue categories"
      aria-orientation="vertical"
      data-testid="catalogue-rail"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-garden-line bg-[#f7f8f6] p-1.5 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0"
    >
      {RAIL_CHOICES.map((choice) => {
        const Icon = ICONS[choice];
        const selected = active === choice;
        return (
          <button
            key={choice}
            id={`catalogue-rail-${choice}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={railLabel(choice)}
            title={railLabel(choice)}
            tabIndex={selected || (active === null && choice === RAIL_CHOICES[0]) ? 0 : -1}
            data-testid={`palette-group-${choice}`}
            onClick={() => onChoose(choice)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                move(choice, 1);
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                move(choice, -1);
              }
            }}
            className={[
              'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
              choice === 'recent' ? 'lg:mt-auto' : '',
              selected
                ? 'bg-garden-forest text-white shadow-sm'
                : 'text-garden-muted hover:bg-garden-sage hover:text-garden-ink',
            ].join(' ')}
          >
            <Icon aria-hidden className="h-[18px] w-[18px]" />
          </button>
        );
      })}
    </div>
  );
}
