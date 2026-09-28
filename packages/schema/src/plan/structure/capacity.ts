import { polygonContainsPolygon } from '../../geometry/primitives.js';
import { elementOutline, type DesignElement } from '../concepts.js';
import { resolveSymbol, type SymbolId } from '../symbols.js';
import type { StructureDefinition } from './definitions.js';

/**
 * How many people a structure is for, read off what stands in it — and how big it would have to be
 * for more.
 *
 * ## Derived, never stored
 *
 * "A dining pergola for six" is a fact about the table under it, and the table is already on the
 * plan as its own element. Storing a capacity on the pergola would be a second answer that goes
 * stale the moment somebody deletes the table or swaps it for a lounge set — the drift this
 * codebase refuses everywhere else. So the count is read every time, from the furniture the
 * structure's outline contains, which is the same "standing on it" rule `attach` and `furnish` use.
 *
 * Approximate on purpose: these are the sizes a garden designer would sketch, not a furniture
 * catalogue.
 */

/**
 * Clear floor all round a piece of furniture inside its host. The generator's `furnish` places by
 * exactly this margin, so `sizeForSeats(4)` is the smallest pergola the generator will furnish.
 */
export const FURNISH_MARGIN = 0.3;

/** People each seating symbol is for. */
const SEATS: Partial<Record<SymbolId, number>> = {
  'dining-set-4': 4,
  'dining-set-6': 6,
  'sofa-set': 5,
  bench: 2,
  lounger: 1,
};

/**
 * A dining table for four is 2.4 m square with its chairs out; each two more add a place's width,
 * which is what `dining-set-6` (3.2 × 2.4 m) is.
 */
const TABLE_BASE = { width: 2.4, depth: 2.4 };
const LENGTH_PER_PAIR = 0.8;

/** The people the furniture standing in this structure seats, or `null` when there is none. */
export function seatsOn(structure: DesignElement, elements: DesignElement[]): number | null {
  const outline = elementOutline(structure);
  let total = 0;
  let found = false;
  for (const other of elements) {
    if (other.id === structure.id || other.hidden) continue;
    const symbol = resolveSymbol(other);
    const seats = symbol ? SEATS[symbol] : undefined;
    if (!seats) continue;
    if (!polygonContainsPolygon(outline, elementOutline(other))) continue;
    total += seats;
    found = true;
  }
  return found ? total : null;
}

/**
 * The footprint a dining structure needs to seat `seats` people at one table, clamped to what the
 * structure may be. Long side first; the caller decides which way it runs.
 *
 * Four is `dining-set-4` plus the margin (3.0 m square), six is `dining-set-6` plus the margin
 * (3.8 × 3.0 m), and each further pair adds another 0.8 m to the table.
 */
export function sizeForSeats(
  definition: StructureDefinition,
  seats: number,
): { long: number; short: number } {
  const pairs = Math.max(0, Math.ceil((Math.max(seats, 4) - 4) / 2));
  const table = { width: TABLE_BASE.width + pairs * LENGTH_PER_PAIR, depth: TABLE_BASE.depth };
  const long = table.width + FURNISH_MARGIN * 2;
  const short = table.depth + FURNISH_MARGIN * 2;
  const limit = Math.min(definition.dimensions.width.max, definition.dimensions.depth.max);
  const floor = Math.max(definition.dimensions.width.min, definition.dimensions.depth.min);
  return {
    long: round(Math.min(Math.max(long, floor), limit)),
    short: round(Math.min(Math.max(short, floor), limit)),
  };
}

function round(metres: number): number {
  return Math.round(metres * 100) / 100;
}
