import { describe, expect, it } from 'vitest';
import { cutEdgeMasks, resolveEdges } from './resolve.js';
import { recommendTreatment, styleEdgeProduct } from './rules.js';
import type { DesignElement } from '../concepts.js';
import type { EdgeRun } from './edge-run.js';

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

const FORMAL = { style: 'formal' as const, budget: 'medium' as const, maintenance: 'medium' as const };

function rect(
  id: string,
  category: DesignElement['category'],
  material: string,
  centre: { x: number; y: number },
  width: number,
  depth: number,
  over: Partial<DesignElement> = {},
): DesignElement {
  return {
    id,
    category,
    material,
    role: 'feature',
    zone: 'back',
    shape: { kind: 'rect', centre, width, depth, rotation: 0 },
    ...over,
  } as DesignElement;
}

/** The patio garden every case below is a variation on. */
function garden(patioOver: Partial<DesignElement> = {}) {
  const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 12 }, 20, 16, {
    role: 'fill',
    fillKind: 'base',
  });
  const path = rect('path', 'paved-area', 'stone-setts', { x: 12.5, y: 9 }, 1, 4);
  const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 6 }, 8, 2, patioOver);
  return [lawn, path, patio];
}

const byHost = (runs: { hostId: string }[], id: string) => runs.filter((run) => run.hostId === id);

describe('the rules', () => {
  it('builds nothing against the house or the fence, whatever the style', () => {
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 6 }, 8, 2);
    expect(recommendTreatment(patio, { kind: 'house' }, FORMAL).treatment).toBe('none');
    expect(recommendTreatment(patio, { kind: 'boundary' }, FORMAL).treatment).toBe('none');
  });

  it('meets paving flush and leaves the same material bare', () => {
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 6 }, 8, 2);
    const setts = { kind: 'element' as const, id: 'p', category: 'paved-area' as const, material: 'stone-setts' };
    const same = { ...setts, material: 'porcelain' };
    expect(recommendTreatment(patio, setts, FORMAL).treatment).toBe('flush');
    expect(recommendTreatment(patio, same, FORMAL).treatment).toBe('none');
  });

  it('contains gravel even where the style asks for no edging', () => {
    const gravel = rect('g', 'gravel-mulch', 'decorative-gravel', { x: 5, y: 5 }, 2, 2);
    const lawn = { kind: 'element' as const, id: 'l', category: 'lawn' as const, material: 'standard-turf' };
    const plain = { style: 'other' as const, budget: 'low' as const, maintenance: 'medium' as const };
    expect(styleEdgeProduct(plain.style, plain.budget, plain.maintenance)).toBeNull();
    expect(recommendTreatment(gravel, lawn, plain).treatment).toBe('steel');
  });

  it('leaves a raised surface to its retaining face', () => {
    const terrace = rect('t', 'paved-area', 'porcelain', { x: 5, y: 5 }, 4, 3, { elevation: 0.34 });
    const lawn = { kind: 'element' as const, id: 'l', category: 'lawn' as const, material: 'standard-turf' };
    expect(recommendTreatment(terrace, lawn, FORMAL).treatment).toBe('none');
  });

  it('never edges stepping stones', () => {
    const stones = rect('s', 'paved-area', 'stepping-stones', { x: 5, y: 5 }, 1, 4);
    const lawn = { kind: 'element' as const, id: 'l', category: 'lawn' as const, material: 'standard-turf' };
    expect(recommendTreatment(stones, lawn, FORMAL).treatment).toBe('none');
  });

  it('says why, every time', () => {
    const patio = rect('patio', 'paved-area', 'porcelain', { x: 10, y: 6 }, 8, 2);
    expect(recommendTreatment(patio, { kind: 'house' }, FORMAL).why).toMatch(/house/);
  });
});

describe('resolveEdges', () => {
  it('edges a patio only where it meets the lawn', () => {
    const { runs } = resolveEdges(garden(), { boundary: PLOT, house: HOUSE }, FORMAL);
    const patio = byHost(runs, 'patio');

    // Brick against the lawn; flush against the path; nothing along the house.
    expect(patio.filter((run) => run.treatment === 'brick').every((run) => run.neighbour?.kind === 'element' && run.neighbour.id === 'lawn')).toBe(true);
    // The flush join to the path is drawn once, by whichever side owns that seam.
    expect(runs.some((run) => run.treatment === 'flush')).toBe(true);
    expect(patio.some((run) => run.neighbour?.kind === 'house')).toBe(false);
    // Never a whole outline: the total is well short of the 20 m perimeter.
    expect(patio.reduce((sum, run) => sum + run.length, 0)).toBeLessThan(16);
  });

  it('draws one join where two surfaces meet, not two', () => {
    const { runs } = resolveEdges(garden(), { boundary: PLOT, house: HOUSE }, FORMAL);
    const patioPath = runs.filter(
      (run) =>
        run.neighbour?.kind === 'element' &&
        ((run.hostId === 'patio' && run.neighbour.id === 'path') ||
          (run.hostId === 'path' && run.neighbour.id === 'patio')),
    );
    expect(patioPath).toHaveLength(1);
  });

  it('draws nothing for a surface set to None, and its neighbours may not put it back', () => {
    const { runs } = resolveEdges(garden({ edges: { mode: 'none', runs: [] } }), { boundary: PLOT, house: HOUSE }, FORMAL);
    expect(byHost(runs, 'patio')).toEqual([]);
    expect(
      runs.some((run) => run.neighbour?.kind === 'element' && run.neighbour.id === 'patio'),
    ).toBe(false);
  });

  it('draws a custom run on part of one side, and leaves the rest of it bare', () => {
    const run: EdgeRun = {
      id: 'r1',
      side: 2,
      anchor: 'start',
      from: 0,
      to: 2.8,
      treatment: 'brick',
      source: 'user',
    };
    const { runs } = resolveEdges(
      garden({ edges: { mode: 'custom', runs: [run] } }),
      { boundary: PLOT, house: HOUSE },
      FORMAL,
    );
    const patio = byHost(runs, 'patio');
    expect(patio).toHaveLength(1);
    expect(patio[0]!.length).toBeCloseTo(2.8, 9);
    expect(patio[0]!.source).toBe('user');
    expect(patio[0]!.materialId).toBe('brick-edging');
  });

  it('honours a run’s own width and height, and gives a flush join no height', () => {
    const runs: EdgeRun[] = [
      { id: 'r1', side: 2, anchor: 'start', from: 0, to: 2, treatment: 'kerb', widthMm: 200, heightMm: 150, source: 'user' },
      { id: 'r2', side: 2, anchor: 'end', from: 0, to: 2, treatment: 'flush', source: 'user' },
    ];
    const resolved = byHost(
      resolveEdges(garden({ edges: { mode: 'custom', runs } }), { boundary: PLOT }, FORMAL).runs,
      'patio',
    );
    const kerb = resolved.find((run) => run.treatment === 'kerb')!;
    const flush = resolved.find((run) => run.treatment === 'flush')!;
    expect(kerb.widthM).toBeCloseTo(0.2, 9);
    expect(kerb.heightM).toBeCloseTo(0.15, 9);
    expect(flush.heightM).toBe(0);
  });
});

describe('cutEdgeMasks', () => {
  it('gives a base fill no cut edge at all', () => {
    const masks = cutEdgeMasks(garden(), { boundary: PLOT, house: HOUSE });
    expect(masks.get('lawn')!.every((keep) => !keep)).toBe(true);
  });

  it('cuts a bed where it meets the lawn and not along the fence', () => {
    const lawn = rect('lawn', 'lawn', 'standard-turf', { x: 10, y: 10 }, 20, 20, { role: 'fill', fillKind: 'base' });
    const border = rect('border', 'planting-bed', 'shrubs', { x: 1.5, y: 10 }, 3, 8, { role: 'fill', fillKind: 'accent' });
    const mask = cutEdgeMasks([lawn, border], { boundary: PLOT }).get('border')!;
    // Rect sides: top, right (the lawn), bottom, left (the fence at x = 0).
    expect(mask).toEqual([true, true, true, false]);
  });
});
