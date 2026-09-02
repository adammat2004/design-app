import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import {
  estimateBudgetBand,
  materialCostIndex,
  groundCoverArea,
  planSchedule,
} from './quantities.js';

/**
 * Moved here with the functions themselves.
 *
 * They lived in the API's generator, which meant the screen that most needs to show a budget could
 * not reach them without a second implementation — the divergence `resolveConstraints` exists to
 * prevent, one layer up. Tests belong with the code they test.
 */

/** A square of paving of a given area, so the weighting can be reasoned about in whole numbers. */
function surface(area: number, material: string): DesignElement {
  const side = Math.sqrt(area);

  return {
    id: material,
    category: 'paved-area',
    role: 'fill',
    fillKind: 'accent',
    shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: side, depth: side, rotation: 0 },
    zone: 'back',
    material,
  };
}

describe('the indicative cost band', () => {
  it('is the area-weighted mean of what the materials cost', () => {
    // Equal areas of cost 1 and cost 3.
    expect(
      materialCostIndex([surface(50, 'gravel-paving'), surface(50, 'timber-decking')]),
    ).toBeCloseTo(2);
  });

  it('weights by area, so the ground cover counts for most of it', () => {
    const index = materialCostIndex([
      surface(200, 'gravel-paving'), // cost 1, and most of the garden
      surface(4, 'stone-pavers'), // cost 4, and a corner of it
    ]);

    expect(index).toBeLessThan(1.1);
  });

  it('ignores the things that have no area', () => {
    const tree: DesignElement = {
      id: 'tree',
      category: 'planting-bed',
      role: 'feature',
      shape: { kind: 'point', at: { x: 0, y: 0 }, radius: 1.6 },
      zone: 'back',
      material: 'shrubs',
    };

    expect(materialCostIndex([surface(100, 'gravel-paving'), tree])).toBeCloseTo(1);
  });

  it('falls back to the category default when a material is missing', () => {
    const bare = { ...surface(100, 'stone-pavers'), material: undefined };

    // `paved-area`'s first entry is natural stone, cost 4.
    expect(materialCostIndex([bare])).toBeCloseTo(4);
  });

  it('reads as a band on the same four the user chose from', () => {
    expect(estimateBudgetBand([surface(10, 'gravel-paving')])).toBe('low');
    expect(estimateBudgetBand([surface(10, 'concrete')])).toBe('medium');
    expect(estimateBudgetBand([surface(10, 'timber-decking')])).toBe('high');
    expect(estimateBudgetBand([surface(10, 'stone-pavers')])).toBe('premium');
  });

  it('has nothing to say about an empty concept', () => {
    expect(materialCostIndex([])).toBe(0);
  });
});

describe('planSchedule', () => {
  const bed = (
    area: number,
    material: string,
    over: Partial<DesignElement> = {},
  ): DesignElement => ({
    ...surface(area, material),
    id: `${material}-${over.id ?? 'a'}`,
    category: 'planting-bed',
    ...over,
  });

  it('groups by material and sums the areas', () => {
    const lines = planSchedule([
      surface(30, 'stone-pavers'),
      { ...surface(20, 'stone-pavers'), id: 'second' },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.areaSqm).toBeCloseTo(50);
    expect(lines[0]!.elementCount).toBe(2);
  });

  it('lists the largest first, because that is what a garden is mostly made of', () => {
    const lines = planSchedule([surface(5, 'concrete'), surface(80, 'gravel-paving')]);

    expect(lines.map((line) => line.materialId)).toEqual(['gravel-paving', 'concrete']);
  });

  it('counts slabs for paving, which is a real product with real dimensions', () => {
    // 600 x 600 on a 10 mm joint, so a shade under three per square metre.
    const [line] = planSchedule([surface(100, 'stone-pavers')]);

    expect(line!.unitLabel).toBe('slabs');
    expect(line!.units).toBeGreaterThan(250);
    expect(line!.units).toBeLessThan(290);
  });

  it('counts boards for decking', () => {
    const [line] = planSchedule([surface(20, 'timber-decking')]);

    expect(line!.unitLabel).toBe('boards');
    expect(line!.units).toBeGreaterThan(0);
  });

  /**
   * The restriction the whole function turns on.
   *
   * `unitsPerSquareMetre` returns a number for a scatter quite happily, and multiplying it by an
   * area would produce a confident "412 plants". But `material-patterns.ts` is explicit that
   * scatter densities are *drawn* densities, tuned so a bed reads as planting at a glance — a
   * border really planted that way would close up in a season. Printing one as a quantity turns a
   * deliberate drawing convention into a shopping list.
   */
  it('refuses to turn a drawn planting density into a quantity to order', () => {
    const [line] = planSchedule([bed(40, 'shrubs')]);

    expect(line!.areaSqm).toBeCloseTo(40);
    expect(line!.units).toBeNull();
    expect(line!.unitLabel).toBeNull();
  });

  it('says nothing about units for a lawn or a pond either', () => {
    for (const material of ['standard-turf', 'naturalistic-pond']) {
      const [line] = planSchedule([{ ...surface(30, material), category: 'lawn' }]);
      expect(line!.units, material).toBeNull();
    }
  });

  it('counts a tree without measuring it', () => {
    // A point has no area, so it contributes to the count and nothing to the square metres.
    const tree: DesignElement = {
      id: 'tree',
      category: 'planting-bed',
      role: 'feature',
      shape: { kind: 'point', at: { x: 0, y: 0 }, radius: 1.6 },
      zone: 'back',
      material: 'shrubs',
    };

    const [line] = planSchedule([tree]);

    expect(line!.elementCount).toBe(1);
    expect(line!.areaSqm).toBe(0);
    expect(line!.units).toBeNull();
  });

  it('leaves out what the plan does not show', () => {
    // A schedule that counts hidden elements is one nobody can check against the drawing.
    const lines = planSchedule([
      surface(30, 'stone-pavers'),
      { ...surface(500, 'concrete'), hidden: true },
    ]);

    expect(lines.map((line) => line.materialId)).toEqual(['stone-pavers']);
  });

  it('falls back to the category default rather than dropping an unnamed surface', () => {
    const bare = { ...surface(20, 'stone-pavers'), material: undefined };

    expect(planSchedule([bare])).toHaveLength(1);
  });

  it('has nothing to say about an empty plan', () => {
    expect(planSchedule([])).toEqual([]);
  });
});

describe('groundCoverArea', () => {
  const base = (area: number, material: string): DesignElement => ({
    ...surface(area, material),
    id: `base-${material}`,
    fillKind: 'base',
  });

  /**
   * The defect this replaced.
   *
   * Summing every element read 196 m2 on a plan whose ground was 135 m2, because a terrace laid on
   * a lawn is two elements over one patch of earth. On the screen a marker looks hardest at, a
   * number half again too big is worse than no number.
   */
  it('counts the ground once, not once per thing standing on it', () => {
    const lawn = base(135, 'standard-turf');
    const terrace = { ...surface(40, 'stone-pavers'), id: 'terrace', fillKind: 'accent' as const };

    expect(groundCoverArea([lawn, terrace])).toBeCloseTo(135);
  });

  it('adds the zones together, because base fills tile without overlapping', () => {
    expect(groundCoverArea([base(60, 'standard-turf'), base(40, 'gravel-paving')])).toBeCloseTo(
      100,
    );
  });

  it('leaves out what the plan does not show', () => {
    expect(
      groundCoverArea([base(60, 'standard-turf'), { ...base(500, 'concrete'), hidden: true }]),
    ).toBeCloseTo(60);
  });

  it('is zero for a layout with no ground, rather than a differently wrong number', () => {
    // The editor can produce one. There is honestly no single ground area, so it says nothing.
    expect(groundCoverArea([surface(30, 'stone-pavers')])).toBe(0);
  });
});

describe('the layer a line belongs to', () => {
  it('separates the ground from what is laid over it', () => {
    const lawn: DesignElement = {
      ...surface(135, 'standard-turf'),
      id: 'lawn',
      fillKind: 'base',
    };
    const terrace = { ...surface(40, 'stone-pavers'), id: 'terrace', fillKind: 'accent' as const };

    const lines = planSchedule([terrace, lawn]);

    // Ground first, whatever order they arrived in — the table reads the way the plan stacks.
    expect(lines.map((line) => line.layer)).toEqual(['ground', 'over']);
    expect(lines[0]!.materialId).toBe('standard-turf');
  });
});
