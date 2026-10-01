import {
  defaultMaterial,
  plantingExclusions,
  structureFloor,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { resolvePattern } from './palette';

export type ElementPass = 'all' | 'ground' | 'object';

/** Physical draw order is independent of the order in which the user added objects. */
export function scenePasses(elements: DesignElement[]) {
  const ground: DesignElement[] = [];
  const objects: DesignElement[] = [];
  for (const element of elements) {
    if (element.hidden) continue;
    /* A fence or a wall is drawn by the boundary painter as a run, never as a surface. */
    if (element.category === 'enclosure') continue;
    const raised =
      element.category === 'structure' ||
      element.category === 'furniture' ||
      element.category === 'lighting' ||
      element.category === 'existing-feature' ||
      (element.category === 'planting-bed' && element.shape.kind === 'point');
    /*
     * A pergola is drawn in both passes: its deck below the shadows, its rafters above them. The
     * deck is its material laid as boards, so only a frame with a board pattern — timber — has one;
     * an aluminium pergola stands on whatever is under it, and a flat metal-coloured slab across the
     * whole footprint would read as dark paving that is not there.
     */
    const floor = structureFloor(element);
    if (floor) {
      /*
       * A structure with a floor lays it here, in place of any painted deck. It is the structure
       * itself painted in its floor material — same id, so clicking or dragging the floor is the
       * pergola, exactly as the deck always was.
       */
      ground.push({ ...element, material: floor.material });
    } else if (!raised || (element.symbol === 'pergola' && hasDeck(element))) {
      ground.push(element);
    }
    if (raised) objects.push(element);
  }
  // Canopies stand above furniture, even when furniture was added later.
  const heightOrder = (element: DesignElement) =>
    /*
     * Lighting last of all, above the canopies. A fitting is the smallest object on the plan and
     * the easiest to lose under one — and an uplight under a tree is precisely the case where it
     * would be hidden by the thing it exists to light.
     */
    element.category === 'lighting'
      ? 4
      : element.category === 'planting-bed'
        ? 3
        : element.category === 'structure'
          ? 2
          : 1;
  objects.sort((a, b) => heightOrder(a) - heightOrder(b));
  return { ground, objects };
}

/** What leaves a gap in a bed's planting is geometry, and lives with the placements in the schema. */
export { plantingExclusions };

export function exclusionMap(elements: DesignElement[]): Map<string, Point[][]> {
  return new Map(
    elements
      .filter((e) => e.category === 'planting-bed' && e.shape.kind !== 'point')
      .map((e) => [e.id, plantingExclusions(e, elements)]),
  );
}

/** A pergola's deck is its material as boards; absent means the category default, which is timber. */
function hasDeck(element: DesignElement): boolean {
  return resolvePattern(element.material ?? defaultMaterial(element.category)) !== null;
}
