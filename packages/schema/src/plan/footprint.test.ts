import { describe, expect, it } from 'vitest';
import {
  elementIsLegal,
  isCanopy,
  legalFootprint,
  MIN_TRUNK_RADIUS,
  TRUNK_FOOTPRINT_RATIO,
} from './footprint.js';
import { geometryIsLegal } from './features.js';
import type { DesignElement } from './concepts.js';

/**
 * The one rule in the system where what a thing is drawn as and what it occupies are different
 * shapes. Four callers decide legality — the editor's drag, the AI run executor, the assistant's
 * planner and the server's PostGIS validator — and the whole value of putting it here is that they
 * cannot disagree. These assert the property rather than the arithmetic.
 */

const boundary = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function tree(x: number, y: number, radius = 2.5): DesignElement {
  return {
    id: 't1',
    category: 'planting-bed',
    role: 'feature',
    name: 'Tree',
    symbol: 'tree-deciduous',
    shape: { kind: 'point', at: { x, y }, radius },
    zone: 'back',
  };
}

describe('the legal footprint', () => {
  it('is the trunk for a tree and the shape itself for everything else', () => {
    const canopy = tree(5, 5);
    const trunk = legalFootprint(canopy);
    expect(trunk).toEqual({
      kind: 'point',
      at: { x: 5, y: 5 },
      radius: 2.5 * TRUNK_FOOTPRINT_RATIO,
    });

    const pond: DesignElement = { ...canopy, symbol: undefined, category: 'water' };
    expect(legalFootprint(pond)).toBe(pond.shape);
  });

  it('never gives a trunk less than its floor, however young the tree is drawn', () => {
    const sapling = legalFootprint(tree(5, 5, 0.4));
    expect(sapling.kind).toBe('point');
    expect(sapling.kind === 'point' && sapling.radius).toBe(MIN_TRUNK_RADIUS);
  });

  it('recognises a canopy only by its symbol, so a point alone is not a tree', () => {
    expect(isCanopy(tree(5, 5))).toBe(true);
    expect(isCanopy({ ...tree(5, 5), symbol: 'furniture-fire-pit' })).toBe(false);
    expect(isCanopy({ ...tree(5, 5), symbol: undefined })).toBe(false);
  });

  /**
   * The behaviour the whole module exists for, stated as the difference it makes: a tree whose
   * branches reach over the fence is in the garden, and the same circle drawn as anything else is
   * not. Asserting both halves is what stops a future "simplification" back to `element.shape`
   * passing — it would only break the first expectation.
   */
  it('lets a canopy overhang the fence while the trunk stays inside it', () => {
    const overhanging = tree(1, 5, 2.5);

    expect(geometryIsLegal(overhanging.shape, boundary)).toBe(false);
    expect(elementIsLegal(overhanging, boundary)).toBe(true);
  });

  it('still refuses a tree whose trunk is outside the fence', () => {
    expect(elementIsLegal(tree(-0.5, 5, 2.5), boundary)).toBe(false);
  });
});
