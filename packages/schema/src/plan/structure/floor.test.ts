import { describe, expect, it } from 'vitest';
import type { DesignElement } from '../concepts.js';
import { planSchedule } from '../quantities.js';
import { mergeStructureConfig } from './config.js';
import { configureStructure } from './configure.js';
import { applyStructurePreset, resolveStructure } from './definitions.js';
import { structureFloor } from './floor.js';

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  material: 'softwood',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 4, depth: 3, rotation: 20 },
  ...over,
});

describe('a structure’s floor', () => {
  it('stands on the garden’s own ground until it is given one', () => {
    expect(resolveStructure(pergola())!.floor).toBeNull();
    expect(structureFloor(pergola())).toBeNull();
  });

  it('resolves a floor it offers, and ignores one it does not', () => {
    expect(resolveStructure(pergola({ structure: { floor: 'porcelain' } }))!.floor).toBe(
      'porcelain',
    );
    expect(resolveStructure(pergola({ structure: { floor: 'standard-turf' } }))!.floor).toBeNull();
    expect(resolveStructure(pergola({ structure: { floor: 'marble' } }))!.floor).toBeNull();
  });

  it('merges and clears like any other setting', () => {
    const floored = mergeStructureConfig({ lighting: true }, { floor: 'stone-setts' });
    expect(floored).toEqual({ lighting: true, floor: 'stone-setts' });
    expect(mergeStructureConfig(floored, { floor: undefined })).toEqual({ lighting: true });
  });

  it('is kept when a style is applied: a style is a look, not a floor', () => {
    const applied = applyStructurePreset(
      pergola({ structure: { floor: 'timber-decking' } }),
      'modern',
    );
    expect(applied.structure?.floor).toBe('timber-decking');
  });

  it('is the structure’s own rect, in the floor material, as paving', () => {
    const floor = structureFloor(pergola({ structure: { floor: 'porcelain' } }))!;
    expect(floor).toMatchObject({ id: 'p1:floor', category: 'paved-area', material: 'porcelain' });
    expect(floor.shape).toEqual(pergola().shape);
  });

  /** The ground under a pergola is laid by the square metre; the footprint is not counted twice. */
  it('is counted in the schedule once, as its floor, with the slabs to lay it', () => {
    const lines = planSchedule([pergola({ structure: { floor: 'porcelain' } })]);
    expect(lines.map((line) => line.materialId)).toEqual(['porcelain']);
    expect(lines[0]!.areaSqm).toBeCloseTo(12);
    expect(lines[0]!.units).toBeGreaterThan(0);
    // Without a floor the footprint is its frame, exactly as before.
    expect(planSchedule([pergola()]).map((line) => line.materialId)).toEqual(['softwood']);
  });

  it('is laid by the generator in the paving it is given, where the structure offers it', () => {
    const site = { elements: [], boundary: [], house: null, towards: null };
    const policy = { style: 'cottage' as const, budget: 'medium' as const, lit: false };
    expect(
      configureStructure(pergola(), { ...policy, floor: 'stone-setts' }, site).structure?.floor,
    ).toBe('stone-setts');
    expect(
      configureStructure(pergola(), { ...policy, floor: 'standard-turf' }, site).structure?.floor,
    ).toBeUndefined();
  });
});
