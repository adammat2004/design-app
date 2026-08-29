import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER } from './concept-colours';
import type { DesignElement, ElementCategory } from './concepts';
import { areaSummary, GROUP_OF, groupElements, groupOf } from './element-groups';

function element(
  id: string,
  category: ElementCategory,
  side: number,
  over: Partial<DesignElement> = {},
): DesignElement {
  return {
    id,
    category,
    role: 'feature',
    name: id,
    shape: { kind: 'rect', centre: { x: 5, y: 5 }, width: side, depth: side, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

describe('GROUP_OF', () => {
  /** Total over the union, so adding a category cannot silently fall out of the summary. */
  it('covers every category', () => {
    for (const category of CATEGORY_ORDER) {
      expect(GROUP_OF[category], category).toBeDefined();
    }
  });

  it('puts paving and structures in hardscape, planting in softscape', () => {
    expect(groupOf(element('a', 'paved-area', 1))).toBe('hardscape');
    expect(groupOf(element('b', 'structure', 1))).toBe('hardscape');
    expect(groupOf(element('c', 'lawn', 1))).toBe('softscape');
    expect(groupOf(element('d', 'planting-bed', 1))).toBe('softscape');
    expect(groupOf(element('e', 'water-feature', 1))).toBe('feature');
  });
});

describe('areaSummary', () => {
  it('is all zeroes for an empty plan, not NaN', () => {
    const summary = areaSummary([], 300);

    expect(summary.planned).toBe(0);
    expect(summary.groups.every((group) => group.share === 0)).toBe(true);
  });

  it('reports site area untouched', () => {
    expect(areaSummary([], 320).siteArea).toBe(320);
  });

  it('totals each group and shares that sum to 100', () => {
    const summary = areaSummary(
      [
        element('a', 'paved-area', 2), // 4 m² hardscape
        element('b', 'lawn', 4), // 16 m² softscape
        element('c', 'water-feature', 2), // 4 m² feature
      ],
      300,
    );

    expect(summary.planned).toBeCloseTo(24, 5);
    expect(summary.groups.find((g) => g.group === 'hardscape')!.area).toBeCloseTo(4, 5);
    expect(summary.groups.find((g) => g.group === 'softscape')!.area).toBeCloseTo(16, 5);

    const total = summary.groups.reduce((sum, group) => sum + group.share, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  /**
   * Shares are of planned surfaces, not of the site. Features sit on ground cover by design, so
   * the footprints overlap — measured against the site they would run past 100% and read as a bug.
   */
  it('can plan more surface than the site has, without breaking the shares', () => {
    const summary = areaSummary(
      [element('a', 'lawn', 10), element('b', 'paved-area', 8)],
      50, // smaller than the 164 m² of surfaces laid on it
    );

    expect(summary.planned).toBeGreaterThan(summary.siteArea);
    const total = summary.groups.reduce((sum, group) => sum + group.share, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  /** The eye toggle means "not this, for now"; a summary that still counted it would disagree. */
  it('leaves hidden elements out', () => {
    const summary = areaSummary(
      [element('a', 'lawn', 4), element('b', 'lawn', 4, { hidden: true })],
      300,
    );

    expect(summary.planned).toBeCloseTo(16, 5);
    expect(summary.groups.find((g) => g.group === 'softscape')!.count).toBe(1);
  });

  it('counts elements per group', () => {
    const summary = areaSummary(
      [element('a', 'paved-area', 2), element('b', 'structure', 2), element('c', 'lawn', 2)],
      300,
    );

    expect(summary.groups.find((g) => g.group === 'hardscape')!.count).toBe(2);
    expect(summary.groups.find((g) => g.group === 'softscape')!.count).toBe(1);
    expect(summary.groups.find((g) => g.group === 'feature')!.count).toBe(0);
  });
});

describe('groupElements', () => {
  it('drops empty groups rather than showing bare headings', () => {
    const groups = groupElements([element('a', 'lawn', 2)]);

    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('softscape');
  });

  it('keeps plan order within a group', () => {
    const groups = groupElements([
      element('a', 'paved-area', 2),
      element('b', 'lawn', 2),
      element('c', 'structure', 2),
    ]);

    expect(groups.find((g) => g.group === 'hardscape')!.elements.map((e) => e.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('keeps hidden elements listed — hiding is not deleting', () => {
    const groups = groupElements([element('a', 'lawn', 2, { hidden: true })]);

    expect(groups[0].elements).toHaveLength(1);
  });
});
