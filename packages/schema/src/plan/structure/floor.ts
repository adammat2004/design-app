import type { DesignElement } from '../concepts.js';
import { resolveStructure } from './definitions.js';

/**
 * The floor laid inside a structure, as a surface the ground pass and the schedule can read.
 *
 * **Derived, never stored.** The floor is a field on the structure (`structure.floor`), so it moves,
 * turns and resizes with it for nothing — there is no second element under the pergola to keep in
 * step. Everything that wants to draw or count it as ground asks here for the same rect in the floor
 * material, which is the one place that rule lives.
 *
 * `null` for anything without a floor: a structure that stands on the garden's own ground, and
 * everything that is not a configurable structure at all.
 */
export function structureFloor(element: DesignElement): DesignElement | null {
  const resolved = resolveStructure(element);
  if (!resolved?.floor || element.shape.kind !== 'rect' || element.hidden) return null;
  return {
    id: `${element.id}:floor`,
    category: 'paved-area',
    role: 'feature',
    name: `${element.name ?? resolved.definition.label} floor`,
    zone: element.zone,
    shape: element.shape,
    material: resolved.floor,
    ...(element.elevation !== undefined ? { elevation: element.elevation } : {}),
  };
}
