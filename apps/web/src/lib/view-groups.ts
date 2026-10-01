import type { DesignElement } from './concepts';

/**
 * The piles a plan can be shown or hidden by — a light version of a CAD layer list.
 *
 * Fixed rather than user-made, and read off each element rather than stored on it, for the reason
 * zones are derived: a layer somebody assigned a bed to by hand is a layer that goes stale the day
 * it becomes a lawn. What a person wants from this is "hide the furniture so I can see the paving"
 * and "show me only the planting", and eight fixed groups answer both.
 *
 * Finer than `element-groups.ts`'s three piles on purpose. Those summarise *area* — "how much of
 * this garden is hard surface" — and a tree has none; this is about what is in the way on screen,
 * where a tree is the thing most often in the way.
 */
export type ViewGroup =
  | 'existing'
  | 'hardscape'
  | 'lawn-beds'
  | 'plants'
  | 'water'
  | 'structures'
  | 'furniture'
  | 'lighting'
  | 'boundaries';

export const VIEW_GROUP_ORDER: ViewGroup[] = [
  'existing',
  'hardscape',
  'lawn-beds',
  'plants',
  'water',
  'structures',
  'furniture',
  'lighting',
  'boundaries',
];

export const VIEW_GROUP_LABELS: Record<ViewGroup, string> = {
  existing: 'Existing features',
  hardscape: 'Paving and paths',
  'lawn-beds': 'Lawn and beds',
  plants: 'Trees and plants',
  water: 'Water',
  structures: 'Structures',
  furniture: 'Furniture',
  lighting: 'Lighting',
  boundaries: 'New fences and walls',
};

export function viewGroupOf(element: DesignElement): ViewGroup {
  switch (element.category) {
    case 'existing-feature':
      return 'existing';
    case 'paved-area':
    case 'gravel-mulch':
      return 'hardscape';
    case 'lawn':
      return 'lawn-beds';
    /* A bed is ground; a tree or a shrub stood in one is a plant — a point on the same category. */
    case 'planting-bed':
      return element.shape.kind === 'point' ? 'plants' : 'lawn-beds';
    case 'water-feature':
      return 'water';
    case 'structure':
      return 'structures';
    case 'furniture':
      return 'furniture';
    case 'lighting':
      return 'lighting';
    case 'enclosure':
      return 'boundaries';
  }
}

/** Whether an element is drawn, given the groups hidden and its own eye toggle. */
export function isShown(element: DesignElement, hiddenGroups: readonly ViewGroup[]): boolean {
  return !element.hidden && !hiddenGroups.includes(viewGroupOf(element));
}
