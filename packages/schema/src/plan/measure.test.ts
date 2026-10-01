import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import { clearances, elementMeasures, ringPerimeter } from './measure.js';

function element(shape: DesignElement['shape'], category: DesignElement['category'] = 'paved-area'): DesignElement {
  return { id: 'e1', category, role: 'feature', shape, zone: 'back' };
}

describe('elementMeasures', () => {
  it('gives a rectangle its area and the distance round it', () => {
    const measures = elementMeasures(
      element({ kind: 'rect', centre: { x: 5, y: 5 }, width: 4, depth: 3, rotation: 30 }),
    );
    expect(measures.area).toBeCloseTo(12);
    expect(measures.perimeter).toBeCloseTo(14);
    expect(measures.length).toBeNull();
  });

  it('gives a path its centreline length, not a perimeter', () => {
    const measures = elementMeasures(
      element({
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 4 },
        ],
        width: 1.2,
      }),
    );
    expect(measures.length).toBeCloseTo(7);
    expect(measures.perimeter).toBeNull();
  });

  it('gives a round surface a perimeter and a tree none', () => {
    const pit = elementMeasures(element({ kind: 'point', at: { x: 0, y: 0 }, radius: 1 }, 'gravel-mulch'));
    expect(pit.perimeter).toBeGreaterThan(6);
    expect(pit.perimeter).toBeLessThan(2 * Math.PI);

    const tree = elementMeasures(element({ kind: 'point', at: { x: 0, y: 0 }, radius: 2 }, 'planting-bed'));
    expect(tree.perimeter).toBeNull();
    expect(tree.length).toBeNull();
  });

  it('measures a polygon on its drawn outline, rounded corners included', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const sharp = elementMeasures(element({ kind: 'polygon', points: square, cornerRadius: 0 }, 'lawn'));
    const rounded = elementMeasures(element({ kind: 'polygon', points: square, cornerRadius: 1 }, 'lawn'));
    expect(sharp.perimeter).toBeCloseTo(16);
    expect(rounded.perimeter!).toBeLessThan(16);
  });
});

describe('ringPerimeter', () => {
  it('closes the ring', () => {
    expect(
      ringPerimeter([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(12);
  });
});

describe('clearances', () => {
  const square = (x: number, y: number, size: number) => [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  const plot = square(0, 0, 20);

  it('measures to the fence and to the nearest thing beside it', () => {
    const { toBoundary, toNearest } = clearances(square(2, 5, 2), {
      boundary: plot,
      obstacles: [square(6, 5, 2), square(12, 5, 2)],
    });
    expect(toBoundary?.distance).toBeCloseTo(2);
    expect(toNearest?.distance).toBeCloseTo(2);
    expect(toNearest?.from.x).toBeCloseTo(4);
    expect(toNearest?.to.x).toBeCloseTo(6);
  });

  it('ignores what it overlaps or stands on', () => {
    const { toNearest } = clearances(square(2, 5, 2), {
      boundary: plot,
      obstacles: [square(1, 4, 4), square(3, 5, 2)],
    });
    expect(toNearest).toBeNull();
  });
});
