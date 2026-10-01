import {
  ADDABLE_SYMBOLS,
  ENCLOSURE_KIND_IDS,
  ENCLOSURE_KINDS,
  PLANT_SPECIES,
  SYMBOLS,
  type ElementCategory,
  type EnclosureKind,
  type PlantSpecies,
  type SunNeed,
  type SymbolId,
} from '@garden-studio/schema';
import { CATEGORY_COLOURS } from './concept-colours';
import { ADDABLE_CATEGORIES } from './element-groups';
import { formatLength, type Unit } from './units';

/**
 * What the editor offers to put on the plan, organised the way a designer reaches for it.
 *
 * Pure: the sidebar draws it, the tests read it. One entry per thing that can be placed — a surface
 * to draw, a symbol, a species, a kind of boundary — each filed under exactly one category of the
 * rail and one subgroup inside it, with the one fact that tells two of them apart at a glance. The
 * rail shows one category at a time, because eighty-odd tiles in one column is a catalogue nobody
 * reads; search is the way across all of them.
 */

export type CatalogueCategory =
  | 'surfaces'
  | 'plants'
  | 'boundaries'
  | 'structures'
  | 'furniture'
  | 'lighting'
  | 'water';

export interface CatalogueCategorySpec {
  id: CatalogueCategory;
  label: string;
  /** Subgroups in the order they are shown. */
  subgroups: string[];
}

export const CATALOGUE_CATEGORIES: CatalogueCategorySpec[] = [
  { id: 'surfaces', label: 'Surfaces', subgroups: ['Surfaces'] },
  { id: 'plants', label: 'Trees & plants', subgroups: ['Trees', 'Shrubs', 'Topiary', 'Plant types'] },
  { id: 'boundaries', label: 'Boundaries', subgroups: ['Fences & screens', 'Walls & hedges', 'Kerbs & openings'] },
  { id: 'structures', label: 'Structures', subgroups: ['Structures'] },
  { id: 'furniture', label: 'Furniture', subgroups: ['Dining', 'Lounging', 'Fire & cooking', 'Pots', 'Play'] },
  { id: 'lighting', label: 'Lighting', subgroups: ['Lighting'] },
  { id: 'water', label: 'Water', subgroups: ['Water'] },
];

/** What choosing an entry arms: a category (with a symbol or a species), or a kind of boundary. */
export type CatalogueArm =
  | { kind: 'place'; category: ElementCategory; symbol?: SymbolId; plantId?: string }
  | { kind: 'enclosure'; enclosure: EnclosureKind };

export interface CatalogueEntry {
  /** Unique, and the tile's `palette-${id}` test id. */
  id: string;
  label: string;
  category: CatalogueCategory;
  subgroup: string;
  /** Everything a search may match: the name, and a botanical name where there is one. */
  search: string;
  arm: CatalogueArm;
  /** Only for a species: what the plant filters read. */
  species?: PlantSpecies;
}

const FURNITURE_SUBGROUP: Partial<Record<SymbolId, string>> = {
  'dining-set-4': 'Dining',
  'dining-set-6': 'Dining',
  'sofa-set': 'Lounging',
  lounger: 'Lounging',
  bench: 'Lounging',
  parasol: 'Lounging',
  bbq: 'Fire & cooking',
  'fire-pit': 'Fire & cooking',
  planter: 'Pots',
  swing: 'Play',
  slide: 'Play',
  trampoline: 'Play',
};

const BOUNDARY_SUBGROUP: Record<EnclosureKind, string> = {
  fence: 'Fences & screens',
  screen: 'Fences & screens',
  railing: 'Fences & screens',
  wall: 'Walls & hedges',
  hedge: 'Walls & hedges',
  kerb: 'Kerbs & openings',
  open: 'Kerbs & openings',
};

/** Which rail category a bare category — drawn to shape rather than placed as a symbol — sits under. */
function categoryOfBare(category: ElementCategory): CatalogueCategory {
  if (category === 'structure') return 'structures';
  if (category === 'water-feature') return 'water';
  return 'surfaces';
}

function categoryOfSymbol(symbol: SymbolId): { category: CatalogueCategory; subgroup: string } {
  const category = SYMBOLS[symbol].category;
  if (category === 'planting-bed') return { category: 'plants', subgroup: 'Plant types' };
  if (category === 'structure') return { category: 'structures', subgroup: 'Structures' };
  if (category === 'lighting') return { category: 'lighting', subgroup: 'Lighting' };
  if (category === 'water-feature') return { category: 'water', subgroup: 'Water' };
  return { category: 'furniture', subgroup: FURNITURE_SUBGROUP[symbol] ?? 'Lounging' };
}

function speciesSubgroup(species: PlantSpecies): string {
  if (species.form === 'tree') return 'Trees';
  return species.symbol === 'shrub-topiary' ? 'Topiary' : 'Shrubs';
}

/** Every placeable thing, in the order each subgroup lists them. */
export function catalogueEntries(): CatalogueEntry[] {
  return [
    /*
     * The categories a user never places as a bare shape are left out: furniture and lighting are
     * always a thing — "a dining set", "a bollard" — and an enclosure is always a kind of boundary.
     */
    ...ADDABLE_CATEGORIES.filter(
      (category) => category !== 'furniture' && category !== 'lighting' && category !== 'enclosure',
    ).map(
      (category): CatalogueEntry => ({
        id: category,
        label: CATEGORY_COLOURS[category].label,
        category: categoryOfBare(category),
        subgroup: CATALOGUE_CATEGORIES.find((spec) => spec.id === categoryOfBare(category))!.subgroups[0]!,
        search: CATEGORY_COLOURS[category].label,
        arm: { kind: 'place', category },
      }),
    ),
    ...ADDABLE_SYMBOLS.map((symbol): CatalogueEntry => ({
      id: symbol,
      label: SYMBOLS[symbol].label,
      ...categoryOfSymbol(symbol),
      search: SYMBOLS[symbol].label,
      arm: { kind: 'place', category: SYMBOLS[symbol].category, symbol },
    })),
    ...PLANT_SPECIES.filter((species) => species.symbol).map((species): CatalogueEntry => ({
      id: species.id,
      label: species.common,
      category: 'plants',
      subgroup: speciesSubgroup(species),
      search: `${species.common} ${species.botanical}`,
      arm: { kind: 'place', category: 'planting-bed', symbol: species.symbol as SymbolId, plantId: species.id },
      species,
    })),
    ...ENCLOSURE_KIND_IDS.map((kind): CatalogueEntry => ({
      id: `enclosure-${kind}`,
      label: ENCLOSURE_KINDS[kind].label,
      category: 'boundaries',
      subgroup: BOUNDARY_SUBGROUP[kind],
      search: `${ENCLOSURE_KINDS[kind].label} ${ENCLOSURE_KINDS[kind].words.join(' ')}`,
      arm: { kind: 'enclosure', enclosure: kind },
    })),
  ];
}

/* ---------------------------------------------------------------- the one fact */

/* Short on purpose: the line sits under a tile about ninety pixels wide. */
const LIGHT_WORDS: Record<string, string> = {
  full: 'sun',
  'full,part': 'sun–part',
  part: 'part shade',
  'part,shade': 'shade',
  shade: 'shade',
  'full,part,shade': 'any light',
};

function lightOf(sun: SunNeed[]): string {
  return LIGHT_WORDS[[...sun].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join(',')] ?? 'any light';
}
const ORDER: SunNeed[] = ['full', 'part', 'shade'];

/**
 * The one line under a tile that tells two things apart: how tall a tree grows and the light it
 * wants, how big a dining set is, how high a screen stands. Never a paragraph — the inspector is
 * where the rest is.
 */
export function detailFor(entry: CatalogueEntry, unit: Unit): string {
  if (entry.species) {
    return `${formatLength(entry.species.matureHeight, unit)} · ${lightOf(entry.species.sun)}`;
  }
  if (entry.arm.kind === 'enclosure') {
    const spec = ENCLOSURE_KINDS[entry.arm.enclosure];
    return entry.arm.enclosure === 'open' ? 'Takes a fence away' : `${formatLength(spec.height, unit)} high`;
  }
  const symbol = entry.arm.symbol;
  if (!symbol) return 'Drawn to shape';
  const spec = SYMBOLS[symbol];
  if (spec.category === 'lighting') return `${formatLength(spec.height, unit)} high`;
  if (spec.footprint.kind === 'rect') {
    return `${formatLength(spec.footprint.width, unit)} × ${formatLength(spec.footprint.depth, unit)}`;
  }
  return `${formatLength(spec.footprint.radius * 2, unit)} across`;
}

/* ---------------------------------------------------------------- search and filters */

const tidy = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether an entry answers a search. Case and punctuation ignored, so "firepit" finds "Fire pit". */
export function matchesSearch(entry: CatalogueEntry, query: string): boolean {
  const wanted = tidy(query);
  return wanted === '' || tidy(entry.search).includes(wanted);
}

export type HeightBand = 'any' | 'low' | 'medium' | 'tall';
export const HEIGHT_BANDS: Record<HeightBand, { label: string; fits: (height: number) => boolean }> = {
  any: { label: 'Any height', fits: () => true },
  low: { label: 'Under 2 m', fits: (height) => height < 2 },
  medium: { label: '2–6 m', fits: (height) => height >= 2 && height <= 6 },
  tall: { label: 'Over 6 m', fits: (height) => height > 6 },
};
export const SUN_LABELS: Record<SunNeed | 'any', string> = {
  any: 'Any light',
  full: 'Full sun',
  part: 'Part shade',
  shade: 'Shade',
};

export interface PlantFilter {
  sun: SunNeed | 'any';
  evergreen: boolean;
  height: HeightBand;
}

export const NO_PLANT_FILTER: PlantFilter = { sun: 'any', evergreen: false, height: 'any' };

export function filterIsSet(filter: PlantFilter): boolean {
  return filter.sun !== 'any' || filter.evergreen || filter.height !== 'any';
}

/**
 * Whether an entry survives the plant filters. Only species have the facts to be filtered on; a
 * generic plant type has none, so while a filter is set it is hidden rather than claimed to pass.
 * Everything outside the plants is untouched by them.
 */
export function passesFilter(entry: CatalogueEntry, filter: PlantFilter): boolean {
  if (entry.category !== 'plants' || !filterIsSet(filter)) return true;
  const species = entry.species;
  if (!species) return false;
  return (
    (filter.sun === 'any' || species.sun.includes(filter.sun)) &&
    (!filter.evergreen || species.evergreen) &&
    HEIGHT_BANDS[filter.height].fits(species.matureHeight)
  );
}

/** The entries of a category, by subgroup in the category's own order, empty subgroups dropped. */
export function bySubgroup(
  entries: CatalogueEntry[],
  category: CatalogueCategory,
): { subgroup: string; entries: CatalogueEntry[] }[] {
  const spec = CATALOGUE_CATEGORIES.find((candidate) => candidate.id === category)!;
  return spec.subgroups
    .map((subgroup) => ({
      subgroup,
      entries: entries.filter((entry) => entry.category === category && entry.subgroup === subgroup),
    }))
    .filter((group) => group.entries.length > 0);
}
