import {
  isPlantSymbol,
  type DesignElement,
  type DesiredFeature,
  type GardenBrief,
  type ZoneId,
} from '@garden-studio/schema';
import type { LayoutPreview } from './layout-generator.js';
import { FEATURE_SPECS } from '../archetypes.js';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';

/**
 * Reading a finished element list back as a design.
 *
 * The evaluator asks which requested feature each element *is* — a rule about the barbecue and the
 * table cannot be measured without knowing which rectangle is which. A candidate from the layout
 * generator knows, because it placed them. A concept that has already been built does not: it
 * carries names like "Seating patio" and "Garden store", and the mapping back is exactly what the
 * generator threw away when it wrote the element.
 *
 * So this recovers it from the plan name, which is the one place the link survives. It is a lookup
 * rather than a guess — `FEATURE_SPECS[feature].planName` is what wrote the name in the first place
 * — and anything it cannot identify is simply not identified, which costs the rules that mention
 * that feature and breaks nothing.
 *
 * **This is a bridge, not architecture.** It exists so the scorer can be built and calibrated
 * against the generator as it stands today, before anything about generation changes, and so the
 * eval harness has a baseline to compare against. Once the layout generator produces candidates
 * that carry their own feature identity, the only caller left is the realised-tier score.
 */

/** The names the generator gives things that are not one of the requested features. */
const NOT_A_FEATURE = new Set([
  'Front path',
  'Side path',
  'Service path',
  'Axis path',
  'Steps',
  'Tree',
  'Side return',
  'Side lounge',
  'Garden lounge',
]);

/**
 * Which requested feature each element is, as far as it can be told.
 *
 * Matched on the plan name, then on the "Second …" prefix the surplus pass adds, then on a small
 * number of names the grammar uses that are not a spec's `planName`. Anything else is left out.
 */
export function identifyFeatures(elements: DesignElement[]): Map<string, DesiredFeature> {
  const byName = new Map<string, DesiredFeature>();
  for (const [feature, spec] of Object.entries(FEATURE_SPECS) as [
    DesiredFeature,
    { planName?: string },
  ][]) {
    if (spec.planName) byName.set(spec.planName, feature);
  }

  /*
   * Two names the grammar produces that no spec claims. The terrace is called after whichever of
   * seating and dining asked for it and falls back to a bare "Terrace" when neither did — which is
   * still the seating area as far as every rule about it is concerned.
   */
  byName.set('Terrace', 'seating');
  byName.set('Garden lounge', 'seating');

  const found = new Map<string, DesiredFeature>();
  for (const element of elements) {
    if (element.hidden || element.role !== 'feature' || !element.name) continue;
    if (isPlantSymbol(element.symbol)) continue;
    if (NOT_A_FEATURE.has(element.name) && element.name !== 'Garden lounge') continue;

    const name = element.name.startsWith('Second ')
      ? element.name.slice('Second '.length)
      : element.name;
    const feature = byName.get(name) ?? byName.get(capitalise(name));
    if (feature) found.set(element.id, feature);
  }

  return found;
}

/**
 * The features a finished concept actually contains, composed ones included.
 *
 * Used by the eval harness to report inclusion rates against what the brief asked for, and read the
 * same way `build` settles its composed checks: from the elements rather than from anything
 * upstream claiming to have placed something.
 */
export function featuresPresent(elements: DesignElement[]): Set<DesiredFeature> {
  const present = new Set(identifyFeatures(elements).values());

  for (const element of elements) {
    if (element.hidden) continue;
    if (element.role === 'fill' && element.fillKind === 'accent' && element.category === 'lawn') {
      present.add('lawn');
    }
    if (element.category === 'planting-bed' && element.role === 'fill') present.add('plantingBeds');
    if (element.category === 'lighting') present.add('lighting');
  }

  return present;
}

/**
 * A rough `GardenBrief`-shaped view of what a concept delivered.
 *
 * Only the eval harness uses this, to report "what fraction of what was asked for is in the
 * drawing" without re-deriving the composed-feature rules a third time.
 */
export function inclusionRate(brief: GardenBrief, elements: DesignElement[]): number {
  const wanted = brief.desiredFeatures;
  if (wanted.length === 0) return 1;
  const present = featuresPresent(elements);
  return wanted.filter((feature) => present.has(feature)).length / wanted.length;
}

/** Whether every feature the library calls composed was drawn. Reported separately in the harness. */
export function composedPresent(elements: DesignElement[]): DesiredFeature[] {
  const present = featuresPresent(elements);
  return (Object.keys(FEATURE_LIBRARY) as DesiredFeature[]).filter(
    (feature) => FEATURE_LIBRARY[feature].composed && present.has(feature),
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ---------------------------------------------------------------- the other direction */

/**
 * A candidate preview read as elements, so the scorer needs to know nothing about previews.
 *
 * **One evaluator, two tiers**, and this is what makes that literally true rather than a claim: the
 * structural tier scores a preview and the realised tier scores a finished concept, and both go
 * through `buildSubject` over a `DesignElement[]`. A second scorer that understood previews would
 * be a second set of opinions to drift.
 *
 * What it cannot supply is what the preview does not have — the base fills, the cut beds, the
 * lighting. The proportion principle therefore reads a preview as having more undesigned ground
 * than the built plan will, which is consistent across every candidate and so does not bias the
 * comparison between them. The finalist is rescored at the realised tier for the honest number.
 */
export function elementsFromPreview(
  preview: LayoutPreview,
  zoneAt: (ring: { x: number; y: number }[]) => ZoneId,
): { elements: DesignElement[]; featureOf: Map<string, DesiredFeature> } {
  const elements: DesignElement[] = [];
  const featureOf = new Map<string, DesiredFeature>();

  /* Ground first: array order is stacking order, and the panel sits under everything. */
  if (preview.lawn) {
    elements.push({
      id: `${preview.id}-panel`,
      category: preview.lawn.category,
      role: 'fill',
      fillKind: 'accent',
      shape: { kind: 'polygon', points: preview.lawn.ring, cornerRadius: 0 },
      zone: zoneAt(preview.lawn.ring),
      material: preview.lawn.category === 'lawn' ? 'standard-turf' : 'decorative-gravel',
    });
  }

  for (const [index, bed] of preview.beds.entries()) {
    elements.push({
      id: `${preview.id}-bed-${index}`,
      category: 'planting-bed',
      role: 'fill',
      fillKind: 'accent',
      name: bed.name,
      shape: { kind: 'polygon', points: bed.ring, cornerRadius: 0 },
      zone: zoneAt(bed.ring),
      material: 'mixed-border',
    });
  }

  for (const route of preview.routes) {
    elements.push({
      id: route.id,
      category: 'paved-area',
      role: 'feature',
      name: route.name,
      shape: route.geometry,
      zone: zoneAt(preview.lawn?.ring ?? []),
      material: 'stone-setts',
    });
  }

  for (const item of preview.placed) {
    elements.push({
      id: item.id,
      category: item.category,
      role: 'feature',
      name: item.name,
      shape: item.geometry,
      zone: zoneAt(item.ring),
      material: FEATURE_SPECS[item.feature].material,
    });
    featureOf.set(item.id, item.feature);
  }

  for (const [index, tree] of preview.trees.entries()) {
    elements.push({
      id: `${preview.id}-tree-${index}`,
      category: 'planting-bed',
      role: 'feature',
      name: 'Tree',
      shape: { kind: 'point', at: tree.at, radius: tree.radius },
      zone: zoneAt([tree.at]),
      symbol: tree.symbol,
    });
  }

  return { elements, featureOf };
}
