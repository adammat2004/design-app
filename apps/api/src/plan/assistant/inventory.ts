import {
  buildBoundaryGraph,
  canBeEdged,
  describeElement,
  edgePlanOf,
  elementArea,
  housePolygon,
  findMaterial,
  formatArea,
  isLocked,
  materialsFor,
  type BoundaryGraph,
  type DesignElement,
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

  /*
   * What each surface meets, from the boundary graph — so "where the patio meets the path" names
   * something the model can see. Names and ids only: the graph knows where every stretch is, and
   * none of that reaches the prompt.
   */
  const graph = buildBoundaryGraph(elements, {
    boundary: document.site.vertices,
    ...(document.site.house ? { house: housePolygon(document.site.house) } : {}),
  });

  lines.push('', 'Elements on the plan:');
  if (elements.length === 0) {
    lines.push('  (none)');
  }

  for (const element of elements) {
    const size = describeElement(element, unit);
    const material = findMaterial(element.material);
    const parts = [
      ...identify(element),
      `in ${element.zone}`,
    ];

    if (size) parts.push(size);
    else parts.push(formatArea(elementArea(element), unit));

    if (material) parts.push(`material=${material.id}`);
    if (element.role === 'fill') parts.push(element.fillKind === 'base' ? 'ground' : 'bed');
    if (canBeEdged(element.category)) {
      const beside = besideOf(graph, element.id, elements);
      if (beside) parts.push(`beside=[${beside}]`);
      parts.push(`edges=${edgePlanOf(element).mode}`);
    }
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

/**
 * What the user has selected on the canvas, so "this" and "it" mean something.
 *
 * The one thing the model is told that is not a fact about the garden: it is a fact about where the
 * pointer is. Without it a sentence like "make this bigger" arrives with no subject at all and the
 * rules quite rightly have the designer ask which element is meant — about the element the user has
 * already clicked on, which reads as the tool not watching.
 *
 * Deliberately just the identity, not a second inventory line. The size, the material, the zone and
 * the locked flag are all a few lines above under `Elements on the plan`, and repeating them here
 * would be a second description of one element that a later edit could let drift from the first.
 * **No position, ever** — the same rule the inventory keeps, and there is a test on it.
 *
 * An id that no longer names an element is dropped rather than reported, exactly as the planner's
 * `resolve` drops one: a selection can go stale between the click and the send, and naming a ghost
 * would have the designer talk about something that is not on the plan. Empty string when there is
 * nothing to say, so the caller drops the heading — a heading with nothing under it invites the
 * model to wonder what was withheld.
 */
export function renderSelection(selection: string[], document: PlanDocument): string {
  const byId = new Map(document.layout.elements.map((element) => [element.id, element]));

  const lines = selection
    .map((id) => byId.get(id))
    .filter((element): element is DesignElement => !!element)
    .map((element) => `  ${identify(element).join(', ')}`);

  if (lines.length === 0) return '';

  return [
    'WHAT THEY HAVE SELECTED',
    lines.length === 1
      ? '(The element they are pointing at on the plan. "This", "it", "that" mean this one.)'
      : '(The elements they are pointing at on the plan. "These", "them" mean this set.)',
    ...lines,
  ].join('\n');
}

/**
 * How an element is named to the model: its id, what it is called, and what it is.
 *
 * Shared by the inventory and the selection so the two cannot describe one element differently —
 * the model matches on the id, and a name rendered one way in one place and another way beside it
 * is exactly the sort of thing that makes it hedge.
 */
function identify(element: DesignElement): string[] {
  return [
    `id=${element.id}`,
    element.name ? `"${element.name}"` : `(unnamed ${element.category})`,
    element.category,
  ];
}

/**
 * The distinct things a surface meets, in the order its boundary meets them. Never a distance.
 */
function besideOf(graph: BoundaryGraph, hostId: string, elements: DesignElement[]): string {
  const seen: string[] = [];
  for (const interval of graph.intervalsOf(hostId)) {
    const { neighbour } = interval;
    let word: string | null = null;
    if (neighbour.kind === 'house') word = 'the house';
    else if (neighbour.kind === 'boundary') word = 'the boundary';
    else if (neighbour.kind === 'element') {
      const other = elements.find((element) => element.id === neighbour.id);
      const name = other?.name ?? neighbour.category;
      word = `${name} (id=${neighbour.id})`;
    }
    if (word && !seen.includes(word)) seen.push(word);
  }
  return seen.join(', ');
}
