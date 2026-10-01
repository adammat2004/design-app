import { speciesById, type SunNeed } from './species.js';
import { PLANTING_MIXES, unsuitedTo } from './mixes.js';
import type { PlantingStyle } from '../planting.js';

/**
 * Which species the generator plants, once it has decided where and how big.
 *
 * **Chosen after the symbol, never before it.** The symbol decides the radius every placement
 * decision is made with — the canopy the placer erodes by, the crown the validator tessellates — so a
 * species that moved it would move trees. Picking inside the symbol keeps every tree exactly where
 * and as wide as it was, and only says what it is.
 */

/**
 * Species per tree symbol, most characteristic first, by the brief's style. A style that says nothing
 * about a symbol takes the default row. Garden-sized trees only: a 12 m pine is a true Scots pine
 * and a bad specimen for a 20 m garden.
 */
const TREE_SPECIES: Record<string, Partial<Record<string, string[]>> & { default: string[] }> = {
  'tree-deciduous': {
    default: ['sorbus-aucuparia', 'betula-pendula', 'crataegus-monogyna'],
    modern: ['betula-pendula', 'acer-campestre', 'sorbus-aucuparia'],
    cottage: ['crataegus-monogyna', 'prunus-tai-haku', 'sorbus-aucuparia'],
    formal: ['carpinus-betulus-fastigiata', 'acer-campestre'],
  },
  'tree-multistem': {
    default: ['betula-utilis-jacquemontii', 'amelanchier-lamarckii'],
    cottage: ['amelanchier-lamarckii', 'betula-utilis-jacquemontii'],
  },
  /* The maple first where it was the only answer, so generated plans keep the tree they had. */
  'tree-ornamental': {
    default: ['acer-palmatum-red', 'malus-evereste', 'cercis-siliquastrum'],
    cottage: ['malus-evereste', 'magnolia-stellata', 'acer-palmatum-red'],
    formal: ['prunus-amanogawa', 'magnolia-stellata'],
  },
  'tree-fruit': { default: ['malus-domestica', 'pyrus-communis', 'prunus-domestica'] },
  'tree-evergreen': {
    default: ['taxus-baccata-fastigiata', 'juniperus-skyrocket'],
    modern: ['juniperus-skyrocket', 'taxus-baccata-fastigiata'],
  },
};

/** Species per shrub symbol. Cycled by the plant's own variant, so a border is a few kinds. */
const SHRUB_SPECIES: Record<string, string[]> = {
  'shrub-evergreen': ['viburnum-tinus', 'pittosporum-tenuifolium', 'choisya-ternata', 'osmanthus-burkwoodii', 'sarcococca-confusa'],
  'shrub-flowering': ['hydrangea-paniculata', 'philadelphus-belle-etoile', 'cornus-alba', 'weigela-florida', 'cotinus-coggygria'],
  'shrub-architectural': ['fatsia-japonica', 'phormium-tenax', 'cordyline-australis'],
  'shrub-topiary': ['buxus-ball', 'ilex-crenata-ball', 'taxus-cone'],
};

/**
 * The species for the `nth` tree of this symbol in a plan. Indexed, never sampled, so a plan
 * regenerated from the same seed plants the same trees — and the preview and the built plan, which
 * both count trees of a symbol in the order they plant them, name the same one.
 */
export function treePlantFor(style: string | null | undefined, symbol: string, nth: number): string | undefined {
  const rows = TREE_SPECIES[symbol];
  if (!rows) return undefined;
  const list = (style && rows[style]) || rows.default;
  return list[nth % list.length];
}

/** The species for a structural shrub, by its symbol and the variant the sampler gave it. */
export function shrubPlantFor(symbol: string, variant: number): string | undefined {
  const list = SHRUB_SPECIES[symbol];
  return list ? list[Math.abs(Math.floor(variant)) % list.length] : undefined;
}

/**
 * The mix a bed is planted with, by the planting style and what the bed is — or `null`, where the
 * bed's material is itself the planting: a hedge is its hedging, a meadow its wildflowers.
 */
export function mixForBed(style: PlantingStyle, material: string | undefined, light: SunNeed | null): string | null {
  if (material === 'hedging' || material === 'wildflower') return null;

  let chosen: string;
  if (material === 'ground-cover') chosen = 'mix-low-maintenance';
  else if (material === 'ornamental-grasses') chosen = style === 'architectural' ? 'mix-sunny-gravel' : 'mix-prairie-grasses';
  else if (material === 'shrubs') chosen = style === 'low-maintenance' ? 'mix-low-maintenance' : 'mix-evergreen-structure';
  else {
    const byStyle: Record<PlantingStyle, string> = {
      contemporary: 'mix-evergreen-structure',
      cottage: 'mix-cottage-border',
      naturalistic: 'mix-prairie-grasses',
      'low-maintenance': 'mix-low-maintenance',
      architectural: 'mix-sunny-gravel',
      pollinator: 'mix-pollinator',
    };
    chosen = byStyle[style];
  }

  /*
   * Then the light, where the plan knows it: a shady border gets the woodland mix whatever the style
   * would have liked, and one in part shade gets the first mix most of which will be content there.
   * A mix planted where half of it will fail is a design fault the schedule would order anyway.
   */
  if (light === 'shade') return 'mix-shade-woodland';
  if (light === 'part') {
    for (const id of [chosen, 'mix-cottage-border', 'mix-evergreen-structure', 'mix-low-maintenance']) {
      const struggling = unsuitedTo(PLANTING_MIXES[id]!.mix, 'part').reduce((sum, entry) => sum + entry.share, 0);
      if (struggling <= 0.25) return id;
    }
    return 'mix-shade-woodland';
  }
  return chosen;
}

/**
 * What a generated tree carries once its species is chosen: the species, its name, and the height it
 * grows to, which is what its shadow is cast from. Empty where no species is catalogued for the
 * symbol, so the tree stays the bare symbol it was.
 */
export function treeStamp(
  style: string | null | undefined,
  symbol: string,
  nth: number,
): { plantId?: string; name?: string; height?: number } {
  const species = speciesById(treePlantFor(style, symbol, nth));
  return species ? { plantId: species.id, name: species.common, height: species.matureHeight } : {};
}
