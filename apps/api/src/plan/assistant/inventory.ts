import {
  describeElement,
  elementArea,
  findMaterial,
  formatArea,
  isLocked,
  materialsFor,
  type GardenZone,
  type PlanDocument,
} from '@garden-studio/schema';

/**
 * What the model is told about the garden.
 *
 * Deliberately a rendered list rather than the raw document. The model's job is to resolve a
 * phrase like "the seating area" to an id and pick a plausible size; it has no use for vertex
 * coordinates, and giving it any would invite it to reason about geometry — which is the planner's
 * job and PostGIS's, not the model's.
 *
 * Every number here is measured off the geometry by the same helpers the editor labels shapes with,
 * so the model and the user are looking at the same figures.
 */
export function renderInventory(document: PlanDocument, zones: GardenZone[]): string {
  const { unit } = document;
  const elements = document.layout.elements;

  const lines: string[] = [];

  lines.push(`Units: ${unit === 'ft' ? 'feet' : 'metres'}.`);

  lines.push('', 'Garden areas:');
  if (zones.length === 0) {
    lines.push('  (none — the house has not been placed)');
  } else {
    for (const zone of zones) {
      const inScope = document.site.selectedZoneIds.includes(zone.id);
      lines.push(
        `  ${zone.id} — ${zone.label}, ${formatArea(zone.area, unit)}${
          inScope ? '' : ' (not being designed)'
        }`,
      );
    }
  }

  lines.push('', 'Elements on the plan:');
  if (elements.length === 0) {
    lines.push('  (none)');
  }

  for (const element of elements) {
    const size = describeElement(element, unit);
    const material = findMaterial(element.material);
    const parts = [
      `id=${element.id}`,
      element.name ? `"${element.name}"` : `(unnamed ${element.category})`,
      element.category,
      `in ${element.zone}`,
    ];

    if (size) parts.push(size);
    else parts.push(formatArea(elementArea(element), unit));

    if (material) parts.push(`material=${material.id}`);
    if (element.role === 'fill') parts.push(element.fillKind === 'base' ? 'ground' : 'bed');
    if (isLocked(element)) parts.push('SHAPE LOCKED — material may change, outline may not');
    if (element.hidden) parts.push('hidden');

    lines.push(`  ${parts.join(', ')}`);
  }

  /*
   * Which materials are legal for which category. Without it the model guesses, and "no gravel
   * lawns" becomes a change the planner silently refuses instead of one it never proposed.
   */
  lines.push('', 'Materials allowed per category:');
  for (const category of new Set(elements.map((element) => element.category))) {
    lines.push(
      `  ${category}: ${materialsFor(category)
        .map((m) => m.id)
        .join(', ')}`,
    );
  }

  return lines.join('\n');
}
