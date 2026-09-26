import { elementArea, isCounted, type DesignElement } from './concepts.js';
import { resolveEdges } from './edges/resolve.js';
import type { EdgeRuleContext } from './edges/rules.js';
import type { Point } from '../geometry/primitives.js';
import type { ElementCategory } from './concepts.js';
import type { BudgetBand } from './brief.js';
import { findMaterial, materialLabel, MATERIALS } from './materials.js';
import { isCountable, materialPattern, unitsPerSquareMetre } from './material-patterns.js';

/**
 * What a plan is made of, counted.
 *
 * This is the payoff of the whole architecture. A plan here is real geometry rather than a
 * generated picture, and the point of insisting on that — through the tessellation rules, the
 * PostGIS validation, the derive-never-store discipline — is that quantities *fall out of it*.
 * Nothing in this file measures anything: it reads areas that `elementArea` already computed from
 * shapes the validator already checked.
 *
 * It lives in the shared package rather than the web app because the numbers are facts about the
 * document, not about how it is drawn. The cost functions moved here from the API's generator for
 * the same reason: they were stranded server-side, so the screen that most needs to show a budget
 * could not reach them without a second implementation.
 */

/** One material, and everything on the plan made of it. */
export interface ScheduleLine {
  /**
   * Which layer of the drawing this sits in.
   *
   * The schedule has to say this, because the areas in it **overlap on purpose**. A base fill is
   * the whole zone polygon and the accents and features are drawn over it — `concepts.ts` is
   * explicit that coverage is a property of the z-order rather than of the arithmetic. So a lawn
   * measuring 135 m2 with a 40 m2 terrace on it shows 95 m2 of grass, and a flat list that added
   * the two would describe a garden half again bigger than the plot.
   *
   * Reporting the layer is the honest fix available without polygon booleans on the client. The
   * exact remainder is computable — the server already does it in `FillService.accentRegions` with
   * PostGIS — but inventing it here from element areas would rely on the generator's disjointness
   * guarantees, which the editor is free to break the moment someone drags one bed over another.
   */
  layer: 'ground' | 'over';
  materialId: string;
  label: string;
  category: ElementCategory;
  /** Total square metres. Zero for things that are counted rather than measured, like a tree. */
  areaSqm: number;
  /** How many separate elements on the plan use this material. */
  elementCount: number;
  /**
   * Linear metres, for the products sold by the metre — which today means edging and nothing else.
   *
   * `null` rather than `0` for everything measured by area, and the distinction matters: a nought
   * would read as "no edging here", where the honest answer for a patio is that linear metres is
   * not the unit it is bought in. The same reason `units` is nullable.
   */
  lengthM: number | null;
  /**
   * Products to order — slabs, boards.
   *
   * `null` wherever a count would be a lie, which is most materials. See `planSchedule`.
   */
  units: number | null;
  unitLabel: string | null;
}

/**
 * Every material on the plan, largest first.
 *
 * **Unit counts are given only for real products, and that restriction is load-bearing.**
 * `unitsPerSquareMetre` will happily return a number for a scatter, but `material-patterns.ts` is
 * explicit that scatter densities are *drawn* densities chosen so a bed reads as planting at a
 * glance — a border really planted at the drawn density would close up in a season. Multiplying one
 * by an area and printing "412 plants" would turn a deliberate drawing convention into a shopping
 * list, which is exactly the misreading that file warns against. Slabs and boards are safe because
 * their manifest entries are real product dimensions.
 *
 * A patio pack is counted too, on the same test rather than as an exception: its members are real
 * product dimensions and a pack is sold by the area it covers, so a count from its mean unit is
 * what a takeoff wants. `isCountable` is where that line is drawn.
 *
 * Hidden elements are excluded: the user has taken them out of the drawing, and a schedule that
 * counts what the plan does not show is a schedule nobody can check.
 */
export function planSchedule(
  elements: DesignElement[],
  /*
   * What edging may not lie along: the boundary ring and the house. Optional, and absent means no
   * exclusion — a caller with neither (a thumbnail, a unit test) gets the honest whole-outline
   * answer rather than a quietly different one. The review screen passes both, which is the number
   * anybody would order against.
   */
  exclude: { boundary?: Point[]; house?: Point[] } = {},
  /** The brief's style, budget and upkeep, which decide what automatic edging lays. */
  rules?: EdgeRuleContext,
): ScheduleLine[] {
  const lines = new Map<string, ScheduleLine>();

  for (const element of elements) {
    if (element.hidden) continue;

    const material = findMaterial(element.material) ?? MATERIALS[element.category][0];
    if (!material) continue;

    const isGround = element.role === 'fill' && element.fillKind === 'base';

    const line = lines.get(material.id) ?? {
      layer: isGround ? ('ground' as const) : ('over' as const),
      materialId: material.id,
      label: materialLabel(material.id),
      category: element.category,
      areaSqm: 0,
      elementCount: 0,
      lengthM: null,
      units: null,
      unitLabel: null,
    };

    /*
     * Furniture and lighting are counted, not measured. A dining set has a footprint for placing
     * and selecting it, but "2.4 m² of teak" is not a quantity anyone orders — the honest line is
     * "1 item". A bollard is the same argument at a twentieth of the size.
     */
    if (!isCounted(element.category)) line.areaSqm += elementArea(element);
    line.elementCount += 1;

    lines.set(material.id, line);
  }

  for (const line of lines.values()) {
    if (isCounted(line.category)) {
      line.units = line.elementCount;
      line.unitLabel = line.elementCount === 1 ? 'item' : 'items';
      continue;
    }
    const counted = countUnits(line.materialId, line.areaSqm);
    line.units = counted?.units ?? null;
    line.unitLabel = counted?.label ?? null;
  }

  /*
   * Edging, which is the one thing on the plan measured in metres rather than in square metres.
   *
   * It has no elements of its own — a run is resolved from the outline of the surface it follows, see
   * `plan/edges/resolve.ts` — so it cannot come out of the loop above and gets its own pass. Only
   * runs that name a product are counted: a flush transition is built but not bought by the metre. Grouped by
   * material like everything else, and laid `over` rather than on the ground, because an edging
   * course is drawn on top of the surface it edges.
   */
  for (const run of resolveEdges(elements, exclude, rules).runs) {
    if (!run.materialId) continue;
    const material = findMaterial(run.materialId);
    if (!material) continue;

    const line = lines.get(material.id) ?? {
      layer: 'over' as const,
      materialId: material.id,
      label: materialLabel(material.id),
      category: 'planting-bed' as ElementCategory,
      areaSqm: 0,
      elementCount: 0,
      lengthM: 0,
      units: null,
      unitLabel: null,
    };

    line.lengthM = (line.lengthM ?? 0) + run.length;
    // Runs rather than areas, which is what the table says it is counting for a length line.
    line.elementCount += 1;
    lines.set(material.id, line);
  }

  for (const line of lines.values()) {
    if (line.lengthM === null) continue;
    // Rounded up for the same reason a slab count is: you cannot order four fifths of a kerb.
    line.units = Math.ceil(line.lengthM);
    line.unitLabel = 'm';
  }

  // Ground first, then what is laid over it — the order the drawing is built in, so the table
  // reads the same way the plan stacks.
  return [...lines.values()].sort(
    (a, b) =>
      Number(a.layer === 'over') - Number(b.layer === 'over') ||
      b.areaSqm - a.areaSqm ||
      a.label.localeCompare(b.label),
  );
}

function countUnits(materialId: string, areaSqm: number): { units: number; label: string } | null {
  if (areaSqm <= 0) return null;

  const pattern = materialPattern(materialId);
  if (!pattern || !isCountable(pattern)) return null;

  const perSquareMetre = unitsPerSquareMetre(pattern);
  if (perSquareMetre === null) return null;

  return {
    // Rounded up, because you cannot order four fifths of a slab.
    units: Math.ceil(areaSqm * perSquareMetre),
    label: pattern.patternType === 'board' ? 'boards' : 'slabs',
  };
}

/**
 * How much ground the design covers, in square metres.
 *
 * **Base fills only, and that is what makes it exact.** Summing every element instead would double
 * count everything stacked — a terrace laid on a lawn is two elements over one patch of ground —
 * and on a plan where most of the garden has something drawn over it, that inflates the total past
 * the size of the plot. Base fills are one per zone and `computeZones` clips half-planes, so they
 * tile the designed area without overlapping each other. The sum is the area, not an estimate of
 * it.
 *
 * A layout with no base fills, which the editor can produce, honestly has no single ground area —
 * so this returns 0 rather than falling back to a number that would be wrong in a different way.
 */
export function groundCoverArea(elements: DesignElement[]): number {
  return elements.reduce(
    (total, element) =>
      element.hidden || element.role !== 'fill' || element.fillKind !== 'base'
        ? total
        : total + elementArea(element),
    0,
  );
}

/* ---------------------------------------------------------------- cost */

/**
 * The plan's average material cost, area-weighted.
 *
 * Expressed as a `BudgetBand` rather than as money, deliberately. `Material.cost` is documented as
 * a *rough relative* figure; turning it into pounds would be inventing a number the model cannot
 * support, and the review screen is exactly where a marker looks hardest. A band reuses the
 * vocabulary the user already chose from on step 3, which also makes "does this match the budget
 * they asked for" a question with an answer.
 *
 * Base fills dominate the weighting, and they should: the ground cover really is most of the cost
 * of a garden.
 */
export function materialCostIndex(elements: DesignElement[]): number {
  let area = 0;
  let weighted = 0;

  for (const element of elements) {
    if (element.hidden) continue;

    const size = elementArea(element);
    // Point features have no area; a tree should not weigh the same as a terrace.
    if (size <= 0) continue;
    // Furniture and lighting are not laid by area, so neither weighs an area-weighted band.
    if (isCounted(element.category)) continue;

    const material = findMaterial(element.material) ?? MATERIALS[element.category][0];
    if (!material) continue;

    area += size;
    weighted += size * material.cost;
  }

  return area > 0 ? weighted / area : 0;
}

/** Thresholds sit between the catalogue's integer costs, so a uniform spec lands in its own band. */
export function bandForCostIndex(index: number): BudgetBand {
  if (index < 1.5) return 'low';
  if (index < 2.5) return 'medium';
  if (index < 3.5) return 'high';
  return 'premium';
}

export function estimateBudgetBand(elements: DesignElement[]): BudgetBand {
  return bandForCostIndex(materialCostIndex(elements));
}
