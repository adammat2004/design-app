import { elementOutline, type DesignElement } from './concepts.js';
import { pointInPolygon } from '../geometry/primitives.js';
import type { SymbolId } from './symbols.js';
import { PLANT_SPECIES } from './plants/species.js';

/**
 * The species that can be placed on their own — trees, shrubs and topiary, the ones with a `symbol`
 * — in the shape the editor has always read: a name, a botanical name, the drawing symbol, and a
 * height and spread that are editable defaults.
 *
 * A view of `PLANT_SPECIES`, not a second list: the catalogue is the one place a species is
 * described. Perennials, grasses and groundcover are planted in beds through a mix, never placed
 * one by one, so they are not in it.
 */
export const PLANT_CATALOGUE: Record<
  string,
  { name: string; botanicalName: string; symbol: SymbolId; height: number; spread: number }
> = Object.fromEntries(
  PLANT_SPECIES.filter((species) => species.symbol).map((species) => [
    species.id,
    {
      name: species.common,
      botanicalName: species.botanical,
      symbol: species.symbol as SymbolId,
      height: species.matureHeight,
      spread: species.matureSpread,
    },
  ]),
);

/** Attach to the topmost bed containing the plant's centre; moving out detaches it. */
export function associatePlants(elements: DesignElement[]): DesignElement[] {
  const beds = elements
    .filter((e) => e.category === 'planting-bed' && e.shape.kind !== 'point' && !e.hidden)
    .map((e) => ({ id: e.id, outline: elementOutline(e) }))
    .reverse();
  return elements.map((element) => {
    if (element.category !== 'planting-bed' || element.shape.kind !== 'point') return element;
    const centre = element.shape.at;
    const bedId = beds.find((bed) => pointInPolygon(centre, bed.outline))?.id;
    if (bedId === element.bedId) return element;
    return { ...element, bedId };
  });
}
