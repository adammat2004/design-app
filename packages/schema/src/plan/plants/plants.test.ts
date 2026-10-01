import { describe, expect, it } from 'vitest';
import { SiteSectionSchema } from '../site.js';
import { isPlantSymbol, isTreeSymbol, type SymbolId } from '../symbols.js';
import { findMaterial, measureOf, MATERIALS } from '../materials.js';
import { areaExposure, bedExposure, sunClass, sunHours } from '../exposure.js';
import type { DesignElement } from '../concepts.js';
import {
  bedMix,
  mixCounts,
  mixMaintenance,
  normalisedMix,
  PLANTING_MIXES,
  unsuitedTo,
  withoutSpecies,
  withShare,
  withSpecies,
  presetMatching,
} from './mixes.js';
import { PLANT_SPECIES, speciesById, speciesNamed } from './species.js';

describe('the plant catalogue', () => {
  it('holds about a hundred species, each once', () => {
    expect(PLANT_SPECIES.length).toBeGreaterThanOrEqual(95);
    expect(new Set(PLANT_SPECIES.map((species) => species.id)).size).toBe(PLANT_SPECIES.length);
  });

  /** A tree placed as a shrub would take a shrub's footprint, and the placer's radius with it. */
  it('gives trees tree symbols and shrubs shrub symbols, and nothing planted in a bed a symbol', () => {
    for (const species of PLANT_SPECIES) {
      if (species.form === 'tree') expect(species.symbol && isTreeSymbol(species.symbol as SymbolId), species.id).toBe(true);
      else if (species.form === 'shrub') {
        expect(species.symbol && isPlantSymbol(species.symbol), species.id).toBe(true);
        expect(isTreeSymbol(species.symbol as SymbolId), species.id).toBe(false);
      } else expect(species.symbol, species.id).toBeUndefined();
    }
  });

  it('keeps every fact in a sensible range', () => {
    for (const species of PLANT_SPECIES) {
      expect(species.matureHeight, species.id).toBeLessThanOrEqual(15);
      expect(species.spacing, species.id).toBeLessThanOrEqual(species.form === 'tree' ? 8 : 2);
      expect(species.flowering.every((month) => month >= 1 && month <= 12), species.id).toBe(true);
    }
  });

  it('finds a species by what people call it, narrowed by form', () => {
    expect(speciesNamed('Hornbeam', ['hedge'])?.id).toBe('carpinus-betulus-hedge');
    expect(speciesNamed('hornbeam', ['tree'])?.id).toBe('carpinus-betulus-fastigiata');
    expect(speciesNamed('a silver birch')?.id).toBe('betula-pendula');
    expect(speciesNamed('Japanese maple')?.id).toBe('acer-palmatum-red');
    expect(speciesNamed('dragon fruit')).toBeUndefined();
    // Inside a longer phrase, by the plant's own name, the longer name first.
    expect(speciesNamed('an old apple tree by the fence', ['tree'])?.id).toBe('malus-domestica');
    expect(speciesNamed('a crab apple', ['tree'])?.id).toBe('malus-evereste');
  });
});

describe('planting mixes', () => {
  it('are planting materials, and each sums to a whole bed of real bed plants', () => {
    const planting = MATERIALS['planting-bed'].map((material) => material.id);
    for (const [id, preset] of Object.entries(PLANTING_MIXES)) {
      expect(planting).toContain(id);
      const total = preset.mix.reduce((sum, entry) => sum + entry.share, 0);
      expect(total, id).toBeCloseTo(1, 9);
      for (const entry of preset.mix) {
        const species = speciesById(entry.speciesId);
        expect(species, `${id} → ${entry.speciesId}`).toBeTruthy();
        expect(['tree', 'hedge'], `${id} → ${entry.speciesId}`).not.toContain(species!.form);
      }
    }
  });

  it('resolves a bed’s own mix over its material’s, and nothing for an older material', () => {
    const own = [{ speciesId: 'vinca-minor', share: 1 }];
    expect(bedMix({ material: 'mix-pollinator', planting: { mix: own } })).toBe(own);
    expect(bedMix({ material: 'mix-pollinator' })).toBe(PLANTING_MIXES['mix-pollinator']!.mix);
    expect(bedMix({ material: 'mixed-border' })).toBeNull();
  });

  /** A count to order: area × share / spacing², rounded up — never the drawn density. */
  it('counts plants from real spacing', () => {
    const [line] = mixCounts([{ speciesId: 'lavandula-hidcote', share: 1 }], 10);
    expect(line?.count).toBe(Math.ceil(10 / (0.45 * 0.45)));
  });

  it('normalises shares and drops what is unknown', () => {
    expect(normalisedMix([{ speciesId: 'vinca-minor', share: 2 }, { speciesId: 'no-such', share: 1 }])).toEqual([
      { speciesId: 'vinca-minor', share: 1 },
    ]);
  });

  it('says which plants a light does not suit, and how demanding a mix is', () => {
    const shade = PLANTING_MIXES['mix-shade-woodland']!.mix;
    expect(unsuitedTo(shade, 'shade')).toEqual([]);
    expect(unsuitedTo(PLANTING_MIXES['mix-sunny-gravel']!.mix, 'shade').length).toBeGreaterThan(0);
    expect(mixMaintenance(PLANTING_MIXES['mix-low-maintenance']!.mix)).toBe('low');
  });
});

describe('materials measured', () => {
  it('buys loose fill by the cubic metre and furniture by the item', () => {
    expect(measureOf(findMaterial('decorative-gravel'), 'gravel-mulch')).toBe('volume');
    expect(findMaterial('decorative-gravel')?.depthMm).toBe(50);
    expect(measureOf(findMaterial('porcelain'), 'paved-area')).toBe('area');
    expect(measureOf(undefined, 'furniture')).toBe('count');
  });
});

describe('sun hours', () => {
  const site = (location: { latitude: number; longitude: number } | null) =>
    SiteSectionSchema.parse({ orientation: 0, location });
  const london = { latitude: 51.5, longitude: -0.1 };
  const spot = { x: 5, y: 5 };
  /** A 3 m wall a metre south of the spot: screen-up is north, so south is +y. */
  const southWall = [{ outline: [{ x: 0, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 6.3 }, { x: 0, y: 6.3 }], height: 3 }];

  it('makes no claim without a location', () => {
    expect(sunHours(site(null), spot, [])).toBeNull();
    expect(areaExposure(site(null), [spot], [])).toBeNull();
  });

  it('gives an open spot a long day and one behind a south wall a short one', () => {
    const open = sunHours(site(london), spot, [])!;
    const shaded = sunHours(site(london), spot, southWall)!;
    expect(open).toBeGreaterThan(10);
    expect(shaded).toBeLessThan(open - 4);
    expect(sunClass(open)).toBe('full');
  });

  it('bands hours as the RHS does', () => {
    expect(sunClass(6)).toBe('full');
    expect(sunClass(4)).toBe('part');
    expect(sunClass(2.5)).toBe('shade');
  });
});

describe('editing a mix by hand', () => {
  const mix = [
    { speciesId: 'lavandula-hidcote', share: 0.5 },
    { speciesId: 'stipa-tenuissima', share: 0.3 },
    { speciesId: 'festuca-glauca', share: 0.2 },
  ];
  const sum = (entries: { share: number }[]) => entries.reduce((total, entry) => total + entry.share, 0);

  it('takes a new share from the others in proportion, and still sums to one', () => {
    const next = withShare(mix, 'lavandula-hidcote', 0.2);
    expect(sum(next)).toBeCloseTo(1);
    expect(next[0]!.share).toBeCloseTo(0.2);
    // The other two keep their 3 : 2 balance.
    expect(next[1]!.share / next[2]!.share).toBeCloseTo(1.5);
  });

  it('adds a species at an equal share and removes one without emptying the bed', () => {
    const added = withSpecies(mix, 'geranium-rozanne');
    expect(added).toHaveLength(4);
    expect(added[3]!.share).toBeCloseTo(0.25);
    expect(sum(added)).toBeCloseTo(1);
    expect(withSpecies(mix, 'not-a-plant')).toHaveLength(3);

    const removed = withoutSpecies(mix, 'lavandula-hidcote');
    expect(removed.map((entry) => entry.speciesId)).toEqual(['stipa-tenuissima', 'festuca-glauca']);
    expect(sum(removed)).toBeCloseTo(1);
    expect(withoutSpecies([{ speciesId: 'festuca-glauca', share: 1 }], 'festuca-glauca')).toHaveLength(1);
  });
});

describe('the light a bed gets', () => {
  const plot = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 12, y: 0 },
    { id: 'c', x: 12, y: 12 },
    { id: 'd', x: 0, y: 12 },
  ];
  const site = (location: { latitude: number; longitude: number } | null) =>
    SiteSectionSchema.parse({ vertices: plot, closed: true, orientation: 0, location, boundaryStyles: [] });
  const bed = (id: string, y: number): DesignElement => ({
    id,
    category: 'planting-bed',
    role: 'feature',
    zone: 'back',
    material: 'mix-shade-woodland',
    shape: { kind: 'rect', centre: { x: 6, y }, width: 4, depth: 1.5, rotation: 0 },
  });
  /** A 4 m garden room just south of the first bed. Screen-up is north. */
  const room: DesignElement = {
    id: 'room',
    category: 'structure',
    role: 'feature',
    zone: 'back',
    height: 4,
    shape: { kind: 'rect', centre: { x: 6, y: 7 }, width: 6, depth: 2, rotation: 0 },
  };

  it('says nothing without a location', () => {
    expect(bedExposure(site(null), bed('b', 5), [room])).toBeNull();
  });

  it('puts a bed north of a building in shade and one in the open in sun', () => {
    const london = { latitude: 51.5, longitude: -0.1 };
    const shaded = bedExposure(site(london), bed('b', 5.1), [room, bed('b', 5.1)])!;
    const open = bedExposure(site(london), bed('b', 3), [bed('b', 3)])!;
    expect(shaded.hours).toBeLessThan(open.hours - 3);
    expect(open.light).toBe('full');
  });
});

describe('presetMatching', () => {
  it('knows a copy of a preset, and an edited one is its own', () => {
    const copy = PLANTING_MIXES['mix-pollinator']!.mix;
    expect(presetMatching(copy)?.id).toBe('mix-pollinator');
    expect(presetMatching(withShare(copy, copy[0]!.speciesId, 0.5))).toBeNull();
  });
});
