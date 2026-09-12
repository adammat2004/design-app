import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import { measureComposition, minExtent } from './composition.js';
import type { GardenZone } from './zones.js';

/*
 * One 10 × 10 m zone; the elements are hand-built so every share is a number that can be checked
 * by eye. Areas here are exact rectangles on a 0.25 m grid, so the sampled shares are exact too.
 */

const zone: GardenZone = {
  id: 'back',
  label: 'Back garden',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  area: 100,
  centroid: { x: 5, y: 5 },
};

let counter = 0;
function element(partial: Partial<DesignElement> & Pick<DesignElement, 'category' | 'shape'>): DesignElement {
  counter += 1;
  return { id: `e${counter}`, role: 'feature', zone: 'back', ...partial };
}

const base = (): DesignElement =>
  element({
    category: 'lawn',
    role: 'fill',
    fillKind: 'base',
    shape: { kind: 'polygon', points: zone.polygon, cornerRadius: 0 },
  });

const rect = (x: number, y: number, width: number, depth: number) =>
  ({ kind: 'rect', centre: { x: x + width / 2, y: y + depth / 2 }, width, depth, rotation: 0 }) as const;

describe('measureComposition', () => {
  it('reads shares from the topmost element, so overlapping areas count once', () => {
    const elements = [
      base(),
      // Two accent lawns over the same ground: 6 × 10 and 4 × 10 overlapping by 2 m.
      element({ category: 'lawn', role: 'fill', fillKind: 'accent', shape: rect(0, 0, 6, 10) }),
      element({ category: 'lawn', role: 'fill', fillKind: 'accent', shape: rect(4, 0, 4, 10) }),
      // A terrace over the lawn.
      element({ category: 'paved-area', name: 'Terrace', shape: rect(0, 0, 4, 3) }),
    ];
    const report = measureComposition(elements, [zone]);

    expect(report.sampledArea).toBe(100);
    expect(report.shares.hard).toBeCloseTo(0.12, 5);
    // 80 m² of lawn less the 12 m² terrace on it.
    expect(report.shares.lawn).toBeCloseTo(0.68, 5);
    expect(report.shares.undesigned).toBeCloseTo(0.2, 5);
    const sum = Object.values(report.shares).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it('names the largest paved rectangle the terrace and measures the panel in its frame', () => {
    const elements = [
      base(),
      element({ category: 'lawn', role: 'fill', fillKind: 'accent', shape: rect(1, 3, 8, 6) }),
      element({ category: 'paved-area', shape: rect(0, 0, 2, 2) }),
      element({ category: 'paved-area', shape: rect(2, 0, 6, 3) }),
    ];
    const report = measureComposition(elements, [zone]);
    expect(report.terrace).toEqual({ width: 6, depth: 3, minDimension: 3, rotation: 0 });
    expect(report.lawn).toEqual({ area: 48, minDimension: 6 });
    expect(report.courtyard).toBe(false);
  });

  it('calls a plan with no open panel a courtyard, and a gravel panel open ground', () => {
    const paved = [base(), element({ category: 'paved-area', shape: rect(0, 0, 10, 4) })];
    expect(measureComposition(paved, [zone]).courtyard).toBe(true);

    const gravel = [
      base(),
      element({ category: 'gravel-mulch', role: 'fill', fillKind: 'accent', shape: rect(0, 4, 10, 6) }),
    ];
    const report = measureComposition(gravel, [zone]);
    expect(report.courtyard).toBe(false);
    expect(report.panel?.category).toBe('gravel-mulch');
    expect(report.lawn).toBeNull();
  });

  it('ignores plants and furniture, which stand on ground rather than covering it', () => {
    const elements = [
      base(),
      element({ category: 'lawn', role: 'fill', fillKind: 'accent', shape: rect(0, 0, 10, 10) }),
      element({
        category: 'planting-bed',
        symbol: 'tree-deciduous',
        shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 2 },
      }),
      element({ category: 'furniture', symbol: 'sofa-set', shape: rect(1, 1, 3, 2.4) }),
    ];
    const report = measureComposition(elements, [zone]);
    expect(report.shares.lawn).toBe(1);
    expect(report.shares.planting).toBe(0);
  });

  it('reports the base per zone and whether the front has lawn', () => {
    const front: GardenZone = {
      ...zone,
      id: 'front',
      label: 'Front garden',
      polygon: zone.polygon.map((p) => ({ x: p.x, y: p.y + 10 })),
      centroid: { x: 5, y: 15 },
    };
    const elements = [
      base(),
      element({
        category: 'gravel-mulch',
        role: 'fill',
        fillKind: 'base',
        zone: 'front',
        shape: { kind: 'polygon', points: front.polygon, cornerRadius: 0 },
      }),
    ];
    const report = measureComposition(elements, [zone, front]);
    expect(report.baseByZone).toEqual({ back: 'lawn', front: 'gravel-mulch' });
    expect(report.frontHasLawn).toBe(false);
    expect(report.sampledArea).toBe(200);
  });

  it('returns zero area and zero shares with no zones', () => {
    const report = measureComposition([base()], []);
    expect(report.sampledArea).toBe(0);
    expect(report.shares.lawn).toBe(0);
  });
});

describe('minExtent', () => {
  it('measures the narrow side in a rotated frame', () => {
    // A 2 × 8 rectangle turned 30°: its axis-aligned box is much wider than 2.
    const points = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 2 },
      { x: 0, y: 2 },
    ].map((p) => {
      const r = (30 * Math.PI) / 180;
      return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
    });
    expect(minExtent(points, 0)).toBeGreaterThan(2.5);
    expect(minExtent(points, 30)).toBeCloseTo(2, 6);
  });
});
