import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import { CROWN_FILL, plantPlacements, type PlacementLayer } from './plant-placements.js';

const outline = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 4 },
  { x: 0, y: 4 },
];

const bed = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'bed-1',
  category: 'planting-bed',
  role: 'fill',
  shape: { kind: 'polygon', points: outline, cornerRadius: 0 },
  zone: 'back',
  material: 'mixed-border',
  ...over,
});

const mass: PlacementLayer = {
  planting: {
    role: 'mass',
    taxon: { type: 'perennial' },
    heightBand: { min: 0.4, max: 0.8 },
    spread: { min: 0.4, max: 0.7 },
    share: 0.9,
    clustering: 0.5,
    edgeAffinity: 0,
  },
  pattern: { patternType: 'scatter', density: 6, sizeRange: { min: 400, max: 700 }, lobes: 7, form: 'blob' },
};

describe('plantPlacements', () => {
  it('is a pure function of its inputs', () => {
    expect(plantPlacements(bed(), [mass], outline, [])).toEqual(plantPlacements(bed(), [mass], outline, []));
  });

  it('draws every plant inside its size band, filled out to maturity', () => {
    const plants = plantPlacements(bed(), [mass], outline, []).filter((plant) => plant.layer === 0);
    expect(plants.length).toBeGreaterThan(0);
    for (const plant of plants) {
      expect(plant.spread).toBeGreaterThanOrEqual(0.4 * CROWN_FILL - 1e-9);
      expect(plant.spread).toBeLessThanOrEqual(0.7 * CROWN_FILL + 1e-9);
      expect(plant.height).toBeGreaterThanOrEqual(0.4);
      expect(plant.height).toBeLessThanOrEqual(0.8);
      for (const draw of Object.values(plant.draws)) {
        expect(draw).toBeGreaterThanOrEqual(0);
        expect(draw).toBeLessThan(1);
      }
    }
  });

  it('keys a plant on its bed, role and world cell, so its identity survives other plants changing', () => {
    const plants = plantPlacements(bed(), [mass], outline, []);
    expect(new Set(plants.map((plant) => plant.id)).size).toBe(plants.length);
    expect(plants.every((plant) => /^bed-1:(mass|backdrop):-?\d+,-?\d+$/.test(plant.id))).toBe(true);
  });

  it('salts the seed by layer index, so a skipped layer still counts', () => {
    const first = plantPlacements(bed(), [mass], outline, []).filter((plant) => plant.layer === 0);
    const second = plantPlacements(bed(), [null, mass], outline, []).filter((plant) => plant.layer === 1);
    expect(first[0]!.seed).toBe('bed-1');
    expect(second[0]!.seed).toBe('bed-1#1');
    // A different seed is a different sample.
    expect(second.map((plant) => plant.at)).not.toEqual(first.map((plant) => plant.at));
  });

  it('adds a shrub understorey to an ordinary border, and to nothing else', () => {
    const understorey = (element: DesignElement, layers: (PlacementLayer | null)[], has?: boolean) =>
      plantPlacements(element, layers, outline, [], has).filter((plant) => plant.layer === 'understorey');

    expect(understorey(bed(), [mass]).length).toBeGreaterThan(0);
    expect(understorey(bed(), [mass])[0]!.seed).toBe('bed-1:understorey');
    // Ground cover is a mat; a mix names its own shrubs; a bed with no planting has nothing to back.
    expect(understorey(bed({ material: 'ground-cover' }), [mass])).toEqual([]);
    expect(understorey(bed({ material: 'mix-shade-woodland' }), [mass])).toEqual([]);
    expect(understorey(bed(), [null], false)).toEqual([]);
  });

  it('keeps the understorey out of the bed margin', () => {
    const plants = plantPlacements(bed(), [mass], outline, []).filter((plant) => plant.layer === 'understorey');
    for (const plant of plants) {
      const margin = Math.min(plant.at.x, 8 - plant.at.x, plant.at.y, 4 - plant.at.y);
      expect(margin).toBeGreaterThanOrEqual((plant.spread / CROWN_FILL) * 0.45 - 1e-9);
    }
  });
});
