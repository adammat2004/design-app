import { describe, expect, it } from 'vitest';
import type { PlacedFeature } from './features.js';
import { heightFor } from './heights.js';
import { isCanopy } from './footprint.js';
import { KEPT_TREE_HEIGHT, keptElement } from './kept.js';

function feature(over: Partial<PlacedFeature>): PlacedFeature {
  return {
    id: 'f1',
    kind: 'tree',
    name: 'Old oak',
    geometry: { kind: 'point', at: { x: 4, y: 4 }, radius: 0.5 },
    status: 'keep',
    replaceWith: null,
    ...over,
  };
}

describe('keptElement', () => {
  it('carries a kept tree over as a tree: a canopy, a crown height and its species', () => {
    const oak = keptElement(feature({ plantId: 'sorbus-aucuparia', spread: 6, height: 7 }), 'k1', 'back');
    expect(oak).toMatchObject({
      category: 'existing-feature',
      symbol: 'tree-deciduous',
      plantId: 'sorbus-aucuparia',
      status: 'keep',
      shape: { kind: 'point', radius: 3 },
    });
    expect(heightFor(oak)).toBe(7);
    expect(isCanopy(oak)).toBe(true);
  });

  it('gives a tree nobody measured its species’ size, or an ordinary garden tree’s', () => {
    expect(heightFor(keptElement(feature({ plantId: 'sorbus-aucuparia' }), 'k', 'back'))).toBe(8);
    expect(heightFor(keptElement(feature({}), 'k', 'back'))).toBe(KEPT_TREE_HEIGHT);
  });

  it('carries a kept fence over as a fence on its line', () => {
    const fence = keptElement(
      feature({
        kind: 'fence',
        name: 'Back fence',
        geometry: { kind: 'polyline', points: [{ x: 0, y: 10 }, { x: 8, y: 10 }], width: 0.2 },
      }),
      'k2',
      'back',
    );
    expect(fence).toMatchObject({ category: 'enclosure', enclosure: { kind: 'fence' }, status: 'keep' });
    expect(heightFor(fence)).toBe(1.8);
  });

  it('carries anything else over as it always was', () => {
    const shed = keptElement(
      feature({ kind: 'shed', name: 'Shed', geometry: { kind: 'rect', centre: { x: 2, y: 2 }, width: 2, depth: 2, rotation: 0 } }),
      'k3',
      'back',
    );
    expect(shed).toEqual({
      id: 'k3',
      category: 'existing-feature',
      role: 'feature',
      name: 'Shed',
      shape: { kind: 'rect', centre: { x: 2, y: 2 }, width: 2, depth: 2, rotation: 0 },
      zone: 'back',
    });
  });
});
