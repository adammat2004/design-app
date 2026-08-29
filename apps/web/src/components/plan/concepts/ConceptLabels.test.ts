import { describe, expect, it } from 'vitest';
import type { CanvasTransform } from '@/lib/canvas-transform';
import type { DesignElement } from '@/lib/concepts';
import { LABEL_HEIGHT } from '@/lib/label-layout';
import type { GardenZone } from '@/lib/zones';
import { layOutConceptLabels } from './ConceptLabels';

const TRANSFORM: CanvasTransform = {
  scale: 32,
  offsetX: 0,
  offsetY: 0,
  stageWidth: 800,
  stageHeight: 600,
};

const SIZE = { width: 800, height: 600 };

function element(
  id: string,
  at: { x: number; y: number },
  role: DesignElement['role'],
): DesignElement {
  return {
    id,
    category: 'paved-area',
    role,
    name: role === 'feature' ? `Feature ${id}` : undefined,
    shape: { kind: 'rect', centre: at, width: 2, depth: 2, rotation: 0 },
    zone: 'back',
  };
}

function zone(id: GardenZone['id'], centroid: { x: number; y: number }): GardenZone {
  return { id, label: `${id} garden`, polygon: [], area: 20, centroid };
}

describe('layOutConceptLabels', () => {
  it('labels features and skips fill regions', () => {
    const laid = layOutConceptLabels(
      [element('a', { x: 5, y: 5 }, 'feature'), element('b', { x: 10, y: 10 }, 'fill')],
      [],
      TRANSFORM,
      SIZE,
    );

    expect(laid).toHaveLength(1);
    expect(laid[0].kind).toBe('element');
  });

  it('skips a feature with no name', () => {
    const nameless = { ...element('a', { x: 5, y: 5 }, 'feature'), name: undefined };

    expect(layOutConceptLabels([nameless], [], TRANSFORM, SIZE)).toEqual([]);
  });

  it('drops labels that are off screen', () => {
    const laid = layOutConceptLabels(
      [element('a', { x: 500, y: 500 }, 'feature')],
      [],
      TRANSFORM,
      SIZE,
    );

    expect(laid).toEqual([]);
  });

  /**
   * The bug this pass exists to prevent. Zone names and feature chips used to be drawn by
   * separate code paths, each certain it had the space to itself, and "Water feature" landed
   * exactly on top of "Front garden" on the plan.
   */
  it('keeps a zone name clear of a feature chip sitting on the same spot', () => {
    const laid = layOutConceptLabels(
      [element('a', { x: 5, y: 5 }, 'feature')],
      [zone('front', { x: 5, y: 5.1 })],
      TRANSFORM,
      SIZE,
    );

    expect(laid).toHaveLength(2);
    const [first, second] = laid;
    expect(second.at.y - first.at.y).toBeGreaterThanOrEqual(LABEL_HEIGHT);
  });

  it('never lets any two labels overlap, whatever the mix', () => {
    const laid = layOutConceptLabels(
      [
        element('a', { x: 4, y: 4 }, 'feature'),
        element('b', { x: 5, y: 4.2 }, 'feature'),
        element('c', { x: 6, y: 4.4 }, 'feature'),
      ],
      [zone('front', { x: 4.5, y: 4.1 }), zone('back', { x: 5.5, y: 4.3 })],
      TRANSFORM,
      SIZE,
    );

    for (let i = 1; i < laid.length; i += 1) {
      expect(laid[i].at.y - laid[i - 1].at.y).toBeGreaterThanOrEqual(LABEL_HEIGHT);
    }
  });

  /**
   * Zones are fed in first so that when both want the same spot the feature chip is the one
   * that moves down. The feature is what the user asked for; the zone name is context, and
   * context should not shove content around.
   */
  it('holds the zone name in place and moves the feature chip', () => {
    const at = { x: 5, y: 5 };
    const laid = layOutConceptLabels(
      [element('a', at, 'feature')],
      [zone('front', at)],
      TRANSFORM,
      SIZE,
    );

    const zoneLabel = laid.find((entry) => entry.kind === 'zone')!;
    const elementLabel = laid.find((entry) => entry.kind === 'element')!;

    expect(zoneLabel.at.y).toBe(5 * TRANSFORM.scale);
    expect(elementLabel.at.y).toBeGreaterThan(zoneLabel.at.y);
  });

  it('has nothing to lay out for a concept with no zones and no features', () => {
    expect(layOutConceptLabels([], [], TRANSFORM, SIZE)).toEqual([]);
  });
});
