import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import { planTakeoff } from './takeoff.js';

function element(over: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    shape: { kind: 'rect', centre: { x: 5, y: 5 }, width: 4, depth: 3, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

/** A 10 × 8 plot: fences on three sides, a 1.2 m wall on the fourth. */
const site = {
  vertices: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 10, y: 8 },
    { id: 'd', x: 0, y: 8 },
  ],
  boundaryStyles: [{ edgeVertexId: 'd', kind: 'wall' as const, height: 1.2 }],
};

describe('planTakeoff', () => {
  it('measures the boundary by kind and height', () => {
    const lines = planTakeoff({ elements: [], site }).filter((line) => line.group === 'boundary');

    expect(lines).toEqual([
      expect.objectContaining({ label: 'Fence', lengthM: 28, detail: '1.8 m high' }),
      expect.objectContaining({ label: 'Wall', lengthM: 8, detail: '1.2 m high' }),
    ]);
  });

  it('leaves out an open side, which has nothing along it', () => {
    const open = { ...site, boundaryStyles: [{ edgeVertexId: 'a', kind: 'open' as const }] };
    const total = planTakeoff({ elements: [], site: open })
      .filter((line) => line.group === 'boundary')
      .reduce((sum, line) => sum + (line.lengthM ?? 0), 0);
    expect(total).toBeCloseTo(26);
  });

  /** A face is priced by its area: a metre holding up a metre is not a metre holding up 150 mm. */
  it('gives a raised terrace its retaining face, by length and area', () => {
    const [face] = planTakeoff({
      elements: [element({ id: 't', elevation: 0.5, retaining: 'brick-walling' })],
    }).filter((line) => line.group === 'levels');

    expect(face?.label).toMatch(/Retaining wall/);
    expect(face?.lengthM).toBeCloseTo(14);
    expect(face?.areaSqm).toBeCloseTo(7);
  });

  it('counts steps from the rise they climb', () => {
    const steps = planTakeoff({
      elements: [
        element({ id: 's1', category: 'structure', symbol: 'steps', elevation: 0.45 }),
        element({ id: 's2', category: 'structure', symbol: 'steps', elevation: 0.3 }),
      ],
    }).find((line) => line.label === 'Steps');

    expect(steps).toEqual(expect.objectContaining({ count: 5, detail: '2 flights' }));
  });

  it('counts light fittings by type, and nothing hidden', () => {
    const lights = planTakeoff({
      elements: [
        element({ id: 'l1', category: 'lighting', symbol: 'light-spike' }),
        element({ id: 'l2', category: 'lighting', symbol: 'light-spike' }),
        element({ id: 'l3', category: 'lighting', symbol: 'light-bollard' }),
        element({ id: 'l4', category: 'lighting', symbol: 'light-bollard', hidden: true }),
      ],
    }).filter((line) => line.group === 'lighting');

    expect(lights.map((line) => [line.label, line.count])).toEqual([
      ['Spike uplight', 2],
      ['Bollard light', 1],
    ]);
  });
});

describe('the planting takeoff', () => {
  const bed = (id: string, over: Partial<DesignElement> = {}) =>
    element({
      id,
      category: 'planting-bed',
      material: 'mix-sunny-gravel',
      shape: { kind: 'rect', centre: { x: 5, y: 5 }, width: 5, depth: 2, rotation: 0 },
      ...over,
    });
  const tree = (id: string, plantId: string) =>
    element({ id, category: 'planting-bed', plantId, shape: { kind: 'point', at: { x: 2, y: 2 }, radius: 2 } });

  it('counts a bed of a mix at each species’ own centres', () => {
    const lines = planTakeoff({ elements: [bed('b')] }).filter((line) => line.group === 'planting');
    const lavender = lines.find((line) => line.label === "Lavender 'Hidcote'");
    // 10 m² × 0.2 of the bed at 0.45 m centres is 9.9, rounded up: you cannot order part of a plant.
    expect(lavender?.count).toBe(10);
    expect(lavender?.detail).toMatch(/0\.45 m centres/);
  });

  it('counts a placed tree once by species, and a bed with no mix not at all', () => {
    const lines = planTakeoff({
      elements: [tree('t1', 'carpinus-betulus-fastigiata'), tree('t2', 'carpinus-betulus-fastigiata'), bed('plain', { material: 'shrubs' })],
    }).filter((line) => line.group === 'planting');
    expect(lines).toEqual([expect.objectContaining({ label: 'Upright hornbeam', count: 2 })]);
  });
});

describe('proposed enclosures in the takeoff', () => {
  it('counts a new screen by the metre and takes its stretch out of the old fence', () => {
    const screen = element({
      id: 'screen',
      category: 'enclosure',
      material: 'slatted-screen',
      enclosure: { kind: 'screen' },
      shape: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }], width: 0.08 },
    });
    const lines = planTakeoff({ elements: [screen], site });
    expect(lines.find((line) => line.group === 'enclosure')).toMatchObject({
      label: 'Screen — Slatted cedar screen',
      lengthM: 6,
      detail: '1.8 m high, new',
    });
    // 28 m of fence before; 6 m of it is the screen now.
    expect(lines.find((line) => line.group === 'boundary' && line.label === 'Fence')?.lengthM).toBeCloseTo(22);
  });
});
