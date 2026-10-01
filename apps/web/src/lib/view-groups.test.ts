import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts';
import { isShown, viewGroupOf } from './view-groups';

function element(over: Partial<DesignElement>): DesignElement {
  return {
    id: 'e1',
    category: 'paved-area',
    role: 'feature',
    shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 1, depth: 1, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

describe('viewGroupOf', () => {
  it('tells a bed from a plant stood in one', () => {
    expect(viewGroupOf(element({ category: 'planting-bed' }))).toBe('lawn-beds');
    expect(
      viewGroupOf(element({ category: 'planting-bed', shape: { kind: 'point', at: { x: 0, y: 0 }, radius: 2 } })),
    ).toBe('plants');
  });

  it('files paving and gravel together', () => {
    expect(viewGroupOf(element({ category: 'gravel-mulch' }))).toBe('hardscape');
    expect(viewGroupOf(element({}))).toBe('hardscape');
  });
});

describe('isShown', () => {
  it('honours both the group and the element’s own eye', () => {
    expect(isShown(element({}), [])).toBe(true);
    expect(isShown(element({}), ['hardscape'])).toBe(false);
    expect(isShown(element({ hidden: true }), [])).toBe(false);
    expect(isShown(element({ category: 'lawn' }), ['hardscape'])).toBe(true);
  });
});
