import { elementOutline, type DesignElement } from './concepts.js';
import { pointInPolygon } from '../geometry/primitives.js';
import type { SymbolId } from './symbols.js';

/** A named plant is separate from its broad drawing symbol. Dimensions are editable defaults. */
export const PLANT_CATALOGUE: Record<
  string,
  { name: string; botanicalName: string; symbol: SymbolId; height: number; spread: number }
> = {
  'acer-palmatum-red': {
    name: 'Japanese maple',
    botanicalName: 'Acer palmatum',
    symbol: 'tree-ornamental',
    height: 3,
    spread: 4,
  },
};

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
