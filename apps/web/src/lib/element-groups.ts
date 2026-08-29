import { elementArea, type DesignElement, type ElementCategory } from './concepts';

/**
 * How the editor's element list and area summary carve a plan into three readable piles.
 *
 * Category is too fine a grain to summarise with — nobody asks "how much gravel-mulch have I
 * got", they ask "how much of this garden is hard surface". Three groups is the coarsest split
 * that still answers that question.
 */

export type ElementGroup = 'hardscape' | 'softscape' | 'feature';

/** Total over `ElementCategory`, so adding a category is a compile error until it is grouped. */
export const GROUP_OF: Record<ElementCategory, ElementGroup> = {
  'paved-area': 'hardscape',
  'gravel-mulch': 'hardscape',
  structure: 'hardscape',
  lawn: 'softscape',
  'planting-bed': 'softscape',
  'water-feature': 'feature',
  'existing-feature': 'feature',
};

export const GROUP_LABELS: Record<ElementGroup, string> = {
  hardscape: 'Hardscapes',
  softscape: 'Softscapes',
  feature: 'Features',
};

/** Display order, used by both the list and the summary so the two always read the same way. */
export const GROUP_ORDER: ElementGroup[] = ['hardscape', 'softscape', 'feature'];

/**
 * The categories the Add palette offers, in the order the editor lists them.
 *
 * `existing-feature` is absent deliberately: that category means "this was already in the garden",
 * which is step 2's answer to give, not something you can draw in step 5.
 */
export const ADDABLE_CATEGORIES: ElementCategory[] = [
  'paved-area',
  'lawn',
  'planting-bed',
  'structure',
  'gravel-mulch',
  'water-feature',
];

export function groupOf(element: DesignElement): ElementGroup {
  return GROUP_OF[element.category];
}

export interface GroupTotal {
  group: ElementGroup;
  label: string;
  area: number;
  /** Percentage of `planned`, 0–100. */
  share: number;
  count: number;
}

export interface AreaSummary {
  /** The whole plot, from the boundary polygon. */
  siteArea: number;
  /** Every visible element's footprint added up. Exceeds `siteArea` where things overlap. */
  planned: number;
  groups: GroupTotal[];
}

/**
 * Live totals for the area summary panel.
 *
 * **`share` is a percentage of `planned`, not of `siteArea`.** A concept stacks features on top of
 * ground cover by design — a pergola sits on a patio which sits on the zone's base fill — so the
 * footprints genuinely overlap and shares against the site would run past 100% and look like a
 * bug. Site area is reported separately, as its own number, which is the honest way to show both.
 *
 * Hidden elements are excluded: the eye toggle is the user saying "not this, for now", and a
 * summary that still counted it would contradict the plan they are looking at.
 */
export function areaSummary(elements: DesignElement[], siteArea: number): AreaSummary {
  const visible = elements.filter((element) => !element.hidden);

  const totals = new Map<ElementGroup, { area: number; count: number }>(
    GROUP_ORDER.map((group) => [group, { area: 0, count: 0 }]),
  );

  for (const element of visible) {
    const bucket = totals.get(groupOf(element))!;
    bucket.area += elementArea(element);
    bucket.count += 1;
  }

  const planned = [...totals.values()].reduce((sum, bucket) => sum + bucket.area, 0);

  return {
    siteArea,
    planned,
    groups: GROUP_ORDER.map((group) => {
      const bucket = totals.get(group)!;

      return {
        group,
        label: GROUP_LABELS[group],
        area: bucket.area,
        // An empty plan is 0%, not NaN%.
        share: planned > 0 ? (bucket.area / planned) * 100 : 0,
        count: bucket.count,
      };
    }),
  };
}

/** The list panel's grouping: same order, elements kept in plan order within each group. */
export function groupElements(
  elements: DesignElement[],
): { group: ElementGroup; label: string; elements: DesignElement[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    elements: elements.filter((element) => groupOf(element) === group),
  })).filter((bucket) => bucket.elements.length > 0);
}
