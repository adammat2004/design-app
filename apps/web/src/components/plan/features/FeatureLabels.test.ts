import { describe, expect, it } from 'vitest';
import type { CanvasTransform } from '@/lib/canvas-transform';
import type { PlacedFeature } from '@/lib/features';
import { DETAIL_SCALE } from '../use-canvas-viewport';
import { layOut } from './FeatureLabels';

/** A stage where one metre is `scale` pixels and the world origin sits at the top-left. */
function transformAt(scale: number): CanvasTransform {
  return { scale, offsetX: 0, offsetY: 0, stageWidth: 800, stageHeight: 600 };
}

const SIZE = { width: 800, height: 600 };

let counter = 0;
function tree(x: number, y: number): PlacedFeature {
  counter += 1;
  return {
    id: `f${counter}`,
    kind: 'tree',
    name: `Tree ${counter}`,
    geometry: { kind: 'point', at: { x, y }, radius: 1 },
    status: 'keep',
    replaceWith: null,
  };
}

describe('label level of detail', () => {
  it('shows full labels once zoomed in past the threshold', () => {
    const laid = layOut([tree(2, 2)], [], true, transformAt(DETAIL_SCALE), SIZE);

    expect(laid).toHaveLength(1);
    expect(laid[0].full).toBe(true);
  });

  it('collapses to chips below the threshold', () => {
    const laid = layOut([tree(2, 2)], [], false, transformAt(DETAIL_SCALE - 1), SIZE);

    expect(laid[0].full).toBe(false);
  });

  it('keeps a selected feature in full detail however far out the view is', () => {
    const one = tree(2, 2);
    const two = tree(5, 2);
    const laid = layOut([one, two], [one.id], false, transformAt(4), SIZE);

    expect(laid.find((entry) => entry.feature.id === one.id)?.full).toBe(true);
    expect(laid.find((entry) => entry.feature.id === two.id)?.full).toBe(false);
  });

  it('drops anything off screen at any zoom', () => {
    // Well beyond the 800x600 stage at 20 px per metre.
    expect(layOut([tree(500, 500)], [], true, transformAt(20), SIZE)).toHaveLength(0);
  });
});

describe('label collisions', () => {
  /** Three features stacked almost on top of each other, in metres. */
  const stacked = [tree(2, 2), tree(2, 2.1), tree(2, 2.2)];

  it('pushes overlapping labels apart rather than letting them pile up', () => {
    const laid = layOut(stacked, [], true, transformAt(20), SIZE);
    const ys = laid.map((entry) => entry.at.y);

    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it('reserves less room for chips than for full labels', () => {
    const spread = (detailed: boolean) => {
      const ys = layOut(stacked, [], detailed, transformAt(20), SIZE).map((e) => e.at.y);
      return Math.max(...ys) - Math.min(...ys);
    };

    // The whole point of collapsing: the same cluster takes up less vertical space.
    expect(spread(false)).toBeLessThan(spread(true));
  });

  it('leaves a lone label exactly on its anchor', () => {
    const laid = layOut([tree(4, 5)], [], true, transformAt(10), SIZE);

    expect(laid[0].at).toEqual({ x: 40, y: 50 });
  });
});
