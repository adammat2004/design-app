import { describe, expect, it } from 'vitest';
import { PLANT_SPECIES, speciesById } from './species.js';
import { PLANTING_MIXES, unsuitedTo } from './mixes.js';
import { mixForBed, shrubPlantFor, treePlantFor } from './choose.js';
import type { PlantingStyle } from '../planting.js';

const STYLES = [undefined, 'modern', 'cottage', 'formal', 'lowMaintenance'];
const TREE_SYMBOLS = ['tree-deciduous', 'tree-multistem', 'tree-ornamental', 'tree-fruit', 'tree-evergreen'];
const SHRUB_SYMBOLS = ['shrub-evergreen', 'shrub-flowering', 'shrub-architectural', 'shrub-topiary'];

describe('choosing species', () => {
  /** A species drawn with another symbol would take that symbol's radius, and move the tree. */
  it('only ever names a real species of the very symbol it was asked for', () => {
    for (const style of STYLES)
      for (const symbol of TREE_SYMBOLS)
        for (let nth = 0; nth < 4; nth += 1) {
          const id = treePlantFor(style, symbol, nth);
          expect(speciesById(id)?.symbol, `${style} ${symbol} ${nth}`).toBe(symbol);
        }
    for (const symbol of SHRUB_SYMBOLS)
      for (let variant = 0; variant < 6; variant += 1) {
        expect(speciesById(shrubPlantFor(symbol, variant))?.symbol).toBe(symbol);
      }
  });

  it('is deterministic, and keeps the Japanese maple as the ornamental it always was', () => {
    expect(treePlantFor('modern', 'tree-ornamental', 0)).toBe('acer-palmatum-red');
    expect(treePlantFor('modern', 'tree-deciduous', 1)).toBe(treePlantFor('modern', 'tree-deciduous', 1));
    expect(treePlantFor(undefined, 'not-a-tree', 0)).toBeUndefined();
  });

  it('gives every catalogued tree symbol at least one species', () => {
    for (const species of PLANT_SPECIES.filter((entry) => entry.form === 'tree')) {
      expect(TREE_SYMBOLS).toContain(species.symbol);
    }
  });
});

describe('mixForBed', () => {
  const styles: PlantingStyle[] = ['contemporary', 'cottage', 'naturalistic', 'low-maintenance', 'architectural', 'pollinator'];

  it('plants a border by its style, and leaves a hedge and a meadow as themselves', () => {
    expect(mixForBed('cottage', 'mixed-border', null)).toBe('mix-cottage-border');
    expect(mixForBed('pollinator', 'mixed-border', null)).toBe('mix-pollinator');
    expect(mixForBed('cottage', 'hedging', null)).toBeNull();
    expect(mixForBed('cottage', 'wildflower', 'full')).toBeNull();
  });

  it('puts a shady bed in the woodland mix, and never leaves most of a mix in the wrong light', () => {
    for (const style of styles) {
      expect(mixForBed(style, 'mixed-border', 'shade')).toBe('mix-shade-woodland');
      const part = mixForBed(style, 'mixed-border', 'part')!;
      const struggling = unsuitedTo(PLANTING_MIXES[part]!.mix, 'part').reduce((sum, entry) => sum + entry.share, 0);
      expect(struggling, `${style} → ${part}`).toBeLessThanOrEqual(0.25);
    }
  });
});
