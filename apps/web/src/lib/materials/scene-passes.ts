import { boundingBox, elementOutline, type DesignElement, type Point } from '@garden-studio/schema';

export type ElementPass = 'all' | 'ground' | 'object';

/** Physical draw order is independent of the order in which the user added objects. */
export function scenePasses(elements: DesignElement[]) {
  const ground: DesignElement[] = [];
  const objects: DesignElement[] = [];
  for (const element of elements) {
    if (element.hidden) continue;
    const raised =
      element.category === 'structure' ||
      element.category === 'furniture' ||
      element.category === 'lighting' ||
      element.category === 'existing-feature' ||
      (element.category === 'planting-bed' && element.shape.kind === 'point');
    if (!raised || element.symbol === 'pergola') ground.push(element);
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

/** Only nearby footprints enter a bed's cache key; distant edits leave its raster intact. */
export function plantingExclusions(bed: DesignElement, elements: DesignElement[]): Point[][] {
  if (bed.category !== 'planting-bed' || bed.shape.kind === 'point' || bed.material === 'hedging')
    return [];
  const box = boundingBox(elementOutline(bed));
  return elements
    .filter(
      (element) =>
        element.id !== bed.id &&
        !element.hidden &&
        (element.role === 'feature' || element.shape.kind === 'point') &&
        !(element.category === 'planting-bed' && element.shape.kind !== 'point'),
    )
    .map(elementOutline)
    .filter((outline) => {
      const other = boundingBox(outline);
      return (
        other.minX < box.minX + box.width &&
        other.minX + other.width > box.minX &&
        other.minY < box.minY + box.length &&
        other.minY + other.length > box.minY
      );
    });
}

export function exclusionMap(elements: DesignElement[]): Map<string, Point[][]> {
  return new Map(
    elements
      .filter((e) => e.category === 'planting-bed' && e.shape.kind !== 'point')
      .map((e) => [e.id, plantingExclusions(e, elements)]),
  );
}
