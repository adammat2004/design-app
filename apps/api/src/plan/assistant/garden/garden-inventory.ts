import {
  describeGeometry,
  featureArea,
  formatArea,
  gardenDirection,
  primaryDoorTowards,
  type GardenZone,
  type PlanDocument,
} from '@garden-studio/schema';

/**
 * What the model is told about the garden it is helping to record.
 *
 * A rendered list rather than the raw document, for the reason `inventory.ts` gives: the model's
 * job is to resolve "that tree" to an id and name a place from a closed list. Vertex coordinates
 * would only invite it to reason about geometry, which is the planner's job and PostGIS's.
 *
 * **No coordinates reach this prompt** — not the boundary's, not the house's, not a feature's. What
 * it gets instead is the one spatial fact it needs and cannot infer: whether there is a house and
 * whether the garden doors are known, because both decide which of the named places are answerable.
 */
export function renderGardenInventory(document: PlanDocument, zones: GardenZone[]): string {
  const { unit } = document;
  const features = document.features.features;
  const site = document.site;

  const lines: string[] = [];

  lines.push(`Units: ${unit === 'ft' ? 'feet' : 'metres'}.`);

  /*
   * Whether the door-relative places can be answered at all. Without it the model cheerfully says
   * `outside-back-door` on a plan with no house, the resolver answers null, and the user is told
   * there was no space when the truth is that there was no door.
   */
  const garden = gardenDirection(site);
  const door = site.house && garden ? primaryDoorTowards(site.house, garden) : null;

  lines.push(
    '',
    site.house
      ? door
        ? 'The house and its garden doors are both mapped, so every named place can be used.'
        : 'The house is mapped but no garden door is, so avoid outside-back-door and outside-front-door.'
      : 'No house is mapped, so avoid the door and beside-the-house places; the corner places still work.',
  );

  lines.push('', 'Garden areas:');
  if (zones.length === 0) {
    lines.push('  (none — the house has not been placed)');
  } else {
    for (const zone of zones) {
      const inScope = site.selectedZoneIds.includes(zone.id);
      lines.push(
        `  ${zone.id} — ${zone.label}, ${formatArea(zone.area, unit)}${
          inScope ? '' : ' (not being redesigned)'
        }`,
      );
    }
  }

  if (site.scopePolygon) {
    lines.push(
      '  A custom redesign area has been drawn. You cannot change it — only whole areas above.',
    );
  }

  lines.push('', 'Existing features already recorded:');
  if (features.length === 0) {
    lines.push('  (none yet)');
  }

  for (const feature of features) {
    const area = featureArea(feature);
    const size = describeGeometry(feature.geometry, unit) || (area ? formatArea(area, unit) : '');

    lines.push(
      `  id=${feature.id}, "${feature.name}", ${feature.kind}${size ? `, ${size}` : ''}` +
        `, status=${feature.status}` +
        (feature.replaceWith ? ` (replace with: ${feature.replaceWith})` : ''),
    );
  }

  return lines.join('\n');
}
