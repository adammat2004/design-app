import { describe, expect, it } from 'vitest';
import { buildBoundaryGraph } from './graph.js';
import type { DesignElement } from '../concepts.js';

const PLOT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

const HOUSE = [
  { x: 6, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 5 },
  { x: 6, y: 5 },
];

function rect(
  id: string,
  category: DesignElement['category'],
  material: string,
  centre: { x: number; y: number },
  width: number,
  depth: number,
): DesignElement {
  return {
    id,
    category,
    material,
    role: 'feature',
    zone: 'back',
    shape: { kind: 'rect', centre, width, depth, rotation: 0 },
  } as DesignElement;
}

describe('buildBoundaryGraph', () => {
  it('reports what each stretch of a patio meets', () => {
    // A patio against the house, with the lawn below it and a path touching its right half.
    const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 12 }, 20, 14);
    const path = rect('path', 'paved-area', 'stone-setts', { x: 12.5, y: 9 }, 1, 4);
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 6 }, 8, 2);

    const graph = buildBoundaryGraph([lawn, path, patio], { boundary: PLOT, house: HOUSE });
    const sides = (side: number) =>
      graph
        .intervalsOf('patio')
        .filter((interval) => interval.side === side)
        .map((interval) => (interval.neighbour.kind === 'element' ? interval.neighbour.id : interval.neighbour.kind));

    expect(sides(0)).toEqual(['house']);
    // The bottom side meets the lawn, then the path, then the lawn again.
    expect(sides(2)).toEqual(['lawn', 'path', 'lawn']);
    expect(graph.between('patio', 'path')).toHaveLength(1);
    expect(graph.between('patio', 'path')[0]!.length).toBeCloseTo(1, 1);
  });

  it('reads the topmost surface, not the one underneath', () => {
    const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 10 }, 20, 20);
    const bed = rect('bed', 'planting-bed', 'shrubs', { x: 10, y: 14 }, 10, 4);
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 10 }, 6, 4);

    const graph = buildBoundaryGraph([lawn, bed, patio], { boundary: PLOT });
    const bottom = graph.intervalsOf('patio').filter((interval) => interval.side === 2);
    // The bed sits over the lawn along the patio's bottom edge, so the bed is the neighbour.
    expect(bottom.map((interval) => interval.neighbour.kind === 'element' && interval.neighbour.id)).toEqual(['bed']);
  });

  it('sees a surface against the fence as facing the boundary', () => {
    const border = rect('border', 'planting-bed', 'shrubs', { x: 1, y: 10 }, 2, 8);
    const graph = buildBoundaryGraph([border], { boundary: PLOT });
    expect(graph.facing('border', (neighbour) => neighbour.kind === 'boundary')).toHaveLength(1);
  });

  it('treats a bed held 150 mm off the fence as against it, and one held off by a mowing strip as not', () => {
    const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 10 }, 20, 20);
    // The generator's own margin: a maintenance gap, not a join.
    const tight = rect('tight', 'planting-bed', 'shrubs', { x: 1.15, y: 10 }, 2, 6);
    // A deliberate strip of grass between the bed and the fence.
    const held = rect('held', 'planting-bed', 'shrubs', { x: 1.6, y: 10 }, 2, 6);

    const graph = buildBoundaryGraph([lawn, tight, held], { boundary: PLOT });
    const leftOf = (id: string) =>
      graph.intervalsOf(id).filter((interval) => interval.side === 3).map((interval) => interval.neighbour.kind);

    expect(leftOf('tight')).toEqual(['boundary']);
    expect(leftOf('held')).toEqual(['element']);
  });

  it('folds a sliver into the neighbour it abuts', () => {
    const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 10 }, 20, 20);
    // A 50 mm sliver of gravel along the patio's edge is sampling, not design.
    const sliver = rect('sliver', 'gravel-mulch', 'decorative-gravel', { x: 10, y: 11.1 }, 0.05, 0.2);
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 10 }, 6, 2);

    const graph = buildBoundaryGraph([lawn, sliver, patio], { boundary: PLOT });
    for (const interval of graph.intervalsOf('patio')) {
      expect(interval.length).toBeGreaterThanOrEqual(0.15 - 1e-9);
    }
  });

  it('is a pure function of its input', () => {
    const elements = [
      rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 10 }, 20, 20),
      rect('patio', 'paved-area', 'porcelain', { x: 10, y: 10 }, 6, 2),
    ];
    const before = structuredClone(elements);
    const a = buildBoundaryGraph(elements, { boundary: PLOT }).intervalsOf('patio');
    const b = buildBoundaryGraph(elements, { boundary: PLOT }).intervalsOf('patio');
    expect(a).toEqual(b);
    expect(elements).toEqual(before);
  });
});
