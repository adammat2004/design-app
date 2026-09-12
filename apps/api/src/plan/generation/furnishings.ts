import { SYMBOLS, type DesiredFeature, type SymbolId } from '@garden-studio/schema';

/**
 * What a requested feature is furnished with, and the least a host must be to hold it.
 *
 * A leaf module, deliberately. `archetypes.ts` imports the template registry, the templates
 * import `sketch.ts`, and the sketch needs the terrace floor — which comes from these tables. If
 * the tables lived in `archetypes.ts` that would be a cycle, the kind that breaks under one
 * module evaluation order and not another. Nothing here imports anything of ours.
 */

/**
 * What a requested feature *is*, when its category cannot say. A store is a shed; a pergola is a
 * pergola. Set on the host element itself, so the drawing knows to give it a roof or posts.
 */
export const HOST_SYMBOLS: Partial<Record<DesiredFeature, SymbolId>> = {
  pergola: 'pergola',
  storage: 'shed',
  vegPatch: 'raised-bed',
};

/**
 * What goes *inside* a requested feature: the table under the pergola, the sofa on the patio.
 *
 * This is the single biggest difference between a plan that reads as designed and one that reads
 * as zoned. A patio with nothing on it is a rectangle; a patio with a lounge set on it is a place.
 * One list per feature, indexed by the concept — the balanced concept gets the sofa, the
 * entertaining one the long table, the retreat a lounger — and `furnish` walks the list until
 * something fits, so a small pergola gets the four-seater rather than nothing.
 */
export const FURNISHINGS: Partial<Record<DesiredFeature, SymbolId[]>> = {
  pergola: ['dining-set-6', 'dining-set-4'],
  seating: ['sofa-set', 'dining-set-6', 'lounger'],
  outdoorKitchen: ['bbq'],
  firePit: ['fire-pit'],
  play: ['swing', 'trampoline', 'slide'],
};

/** Clear surface kept round an item, so a table does not touch the edge of its patio. */
export const MARGIN = 0.3;

/**
 * The smallest host that can hold what a feature is furnished with.
 *
 * This is where a terrace's minimum size comes from — not a constant beside the terrace, but the
 * footprint of the thing the terrace exists to hold, plus the margin `fitInside` keeps round it.
 * Read from `FURNISHINGS` so it moves when the list does.
 *
 * `primary` is the first entry, the item the concept would rather place; `smallest` is the least
 * the host must hold to be furnished at all. The terrace asks for the primary (a terrace too
 * small for the sofa set is a terrace in name only); a pergola asks for the smallest, because
 * `furnish` walks the list and a four-seater under a pergola is still a dining pergola.
 *
 * ```
 *   FURNISHINGS[feature] ─► SYMBOLS[symbol].footprint ─► + 2 × MARGIN ─► { width, depth }
 * ```
 */
export function hostFloor(
  feature: DesiredFeature,
  pick: 'primary' | 'smallest' = 'primary',
): { width: number; depth: number } {
  const choices = FURNISHINGS[feature] ?? [];
  const floors = choices.map((symbol) => {
    const { footprint } = SYMBOLS[symbol];
    return footprint.kind === 'point'
      ? { width: footprint.radius * 2 + MARGIN * 2, depth: footprint.radius * 2 + MARGIN * 2 }
      : { width: footprint.width + MARGIN * 2, depth: footprint.depth + MARGIN * 2 };
  });
  if (floors.length === 0) return { width: 0, depth: 0 };
  if (pick === 'primary') return floors[0]!;
  return floors.reduce((best, floor) =>
    floor.width * floor.depth < best.width * best.depth ? floor : best,
  );
}
