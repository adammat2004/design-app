import { describe, expect, it } from 'vitest';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import type { DesignElement } from '@/lib/concepts';
import { elementThumbnailGeometry } from './ElementThumbnail';

function rect(width: number, depth: number, over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'x',
    category: 'paved-area',
    role: 'feature',
    name: 'Patio',
    shape: { kind: 'rect', centre: { x: 40, y: 40 }, width, depth, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

function points(source: string): { x: number; y: number }[] {
  return source.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

describe('elementThumbnailGeometry', () => {
  it('projects a rectangle into the chip', () => {
    const plan = elementThumbnailGeometry(rect(4, 3));

    expect(plan).not.toBeNull();
    expect(points(plan!.points)).toHaveLength(4);
  });

  it('keeps everything inside the viewBox', () => {
    for (const element of [rect(4, 3), rect(0.5, 20), rect(20, 0.5)]) {
      for (const point of points(elementThumbnailGeometry(element)!.points)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(48);
        expect(point.y).toBeLessThanOrEqual(48);
      }
    }
  });

  /**
   * The chip frames the element's own box, not the garden's, so a 1 m water bowl and a 20 m lawn
   * both fill it. Without that the small things would be invisible specks.
   */
  it('fills the chip regardless of the element’s real size', () => {
    const small = points(elementThumbnailGeometry(rect(1, 1))!.points);
    const large = points(elementThumbnailGeometry(rect(20, 20))!.points);

    const span = (list: { x: number }[]) =>
      Math.max(...list.map((p) => p.x)) - Math.min(...list.map((p) => p.x));

    expect(span(small)).toBeCloseTo(span(large), 5);
  });

  it('centres the axis with slack, so a thin shape does not hug the edge', () => {
    const thin = points(elementThumbnailGeometry(rect(20, 2))!.points);
    const top = Math.min(...thin.map((p) => p.y));
    const bottom = Math.max(...thin.map((p) => p.y));

    expect(top).toBeCloseTo(48 - bottom, 1);
  });

  it('takes its colour from the material, not the category', () => {
    expect(elementThumbnailGeometry(rect(4, 3, { material: 'timber-decking' }))!.fill).toBe(
      '#d3c0a3',
    );
    expect(elementThumbnailGeometry(rect(4, 3))!.stroke).toBe(
      CATEGORY_COLOURS['paved-area'].stroke,
    );
  });

  it('has nothing to draw for a degenerate shape', () => {
    const point = rect(1, 1, { shape: { kind: 'point', at: { x: 0, y: 0 }, radius: 0 } });

    expect(elementThumbnailGeometry(point)).toBeNull();
  });
});
