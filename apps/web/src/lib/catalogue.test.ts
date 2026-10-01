import { describe, expect, it } from 'vitest';
import { ADDABLE_SYMBOLS, ENCLOSURE_KIND_IDS, PLANT_SPECIES } from '@garden-studio/schema';
import {
  bySubgroup,
  CATALOGUE_CATEGORIES,
  catalogueEntries,
  detailFor,
  matchesSearch,
  NO_PLANT_FILTER,
  passesFilter,
} from './catalogue';

const entries = catalogueEntries();

describe('the catalogue', () => {
  /** Anything placeable missing from the rail is a thing the editor cannot add any more. */
  it('files every placeable thing once, in a category and a subgroup that exist', () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const symbol of ADDABLE_SYMBOLS) expect(ids).toContain(symbol);
    for (const species of PLANT_SPECIES.filter((entry) => entry.symbol)) expect(ids).toContain(species.id);
    for (const kind of ENCLOSURE_KIND_IDS) expect(ids).toContain(`enclosure-${kind}`);
    for (const surface of ['paved-area', 'lawn', 'planting-bed', 'gravel-mulch', 'structure', 'water-feature']) {
      expect(ids).toContain(surface);
    }

    for (const entry of entries) {
      const category = CATALOGUE_CATEGORIES.find((spec) => spec.id === entry.category);
      expect(category?.subgroups, entry.id).toContain(entry.subgroup);
    }
  });

  it('adds up: every entry is in one subgroup of its category', () => {
    const shown = CATALOGUE_CATEGORIES.flatMap((spec) => bySubgroup(entries, spec.id)).reduce(
      (sum, group) => sum + group.entries.length,
      0,
    );
    expect(shown).toBe(entries.length);
  });

  it('puts the things where a designer reaches for them', () => {
    const at = (id: string) => entries.find((entry) => entry.id === id)!;
    expect(at('betula-pendula')).toMatchObject({ category: 'plants', subgroup: 'Trees' });
    expect(at('buxus-ball')).toMatchObject({ category: 'plants', subgroup: 'Topiary' });
    expect(at('tree-deciduous')).toMatchObject({ category: 'plants', subgroup: 'Plant types' });
    expect(at('fire-pit')).toMatchObject({ category: 'furniture', subgroup: 'Fire & cooking' });
    expect(at('trampoline')).toMatchObject({ category: 'furniture', subgroup: 'Play' });
    expect(at('enclosure-hedge')).toMatchObject({ category: 'boundaries', subgroup: 'Walls & hedges' });
    expect(at('pergola')).toMatchObject({ category: 'structures' });
    expect(at('water-feature')).toMatchObject({ category: 'water' });
  });

  it('says the one fact that tells two tiles apart', () => {
    const at = (id: string) => detailFor(entries.find((entry) => entry.id === id)!, 'm');
    expect(at('betula-pendula')).toMatch(/^10(\.0)? m · sun/);
    expect(at('dining-set-4')).toMatch(/×/);
    expect(at('enclosure-screen')).toMatch(/1\.8 m high/);
    expect(at('lawn')).toBe('Drawn to shape');
  });
});

describe('search and filters', () => {
  it('finds by either name, ignoring case and punctuation', () => {
    const found = (query: string) => entries.filter((entry) => matchesSearch(entry, query)).map((entry) => entry.id);
    expect(found('Carpinus')).toContain('carpinus-betulus-fastigiata');
    expect(found('firepit')).toContain('fire-pit');
    expect(found('slatted')).toContain('enclosure-screen');
    expect(found('helicopter')).toEqual([]);
  });

  it('narrows the plants only, and hides a plant type that has no facts to filter on', () => {
    const evergreen = { ...NO_PLANT_FILTER, evergreen: true };
    const at = (id: string) => entries.find((entry) => entry.id === id)!;
    expect(passesFilter(at('betula-pendula'), evergreen)).toBe(false);
    expect(passesFilter(at('viburnum-tinus'), evergreen)).toBe(true);
    expect(passesFilter(at('tree-deciduous'), evergreen)).toBe(false);
    expect(passesFilter(at('dining-set-4'), evergreen)).toBe(true);
    expect(passesFilter(at('tree-deciduous'), NO_PLANT_FILTER)).toBe(true);
  });
});
