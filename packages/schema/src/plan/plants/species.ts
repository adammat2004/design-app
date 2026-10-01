import { z } from 'zod';
import { MaintenanceLevelSchema, type MaintenanceLevel } from '../brief.js';
import type { SymbolId } from '../symbols.js';

/**
 * The plants a garden here can be planted with: about a hundred ordinary UK garden plants, each with
 * the few facts a designer chooses by.
 *
 * **Small on purpose, and accurate over large.** Mature size, the light it wants, whether it keeps
 * its leaves, when it flowers, how far apart it is planted, how hardy it is and how much looking
 * after it needs — the columns of a planting plan, and the questions "will this grow here" and "how
 * many do I buy" turn on. Nothing here is a horticultural database; a species that is not listed is
 * not wrong, it is simply not offered yet.
 *
 * **Every species is drawn by art that already exists.** `art` pins one variant of a sprite family
 * the asset library already carries — the lavender is the lavender picture, the birch the birch — and
 * a species with no picture of its own pins the nearest family's. So the catalogue can grow without
 * paying for a single new image, and a web test holds every pin to a real family and variant. The
 * family id is a plain string here for the reason `material` is one: the asset manifest lives in the
 * web app, and this package must not import it.
 *
 * **`spacing` is a real planting distance, never the drawn density.** `material-patterns.ts` is
 * explicit that a scatter is drawn at a density chosen to read well on a plan, and a border really
 * planted at it would close up in a season. `spacing` is the centres a nursery would plant at, so
 * `area × share / spacing²` is a number somebody can order.
 *
 * Hardiness uses the RHS ratings: H3 half-hardy (to about -5 °C), H4 hardy in an average winter (to
 * -10), H5 in a cold winter (to -15), H6 in a very cold winter (to -20), H7 very hardy.
 */

export const PlantFormSchema = z.enum(['tree', 'shrub', 'hedge', 'perennial', 'grass', 'groundcover']);
export type PlantForm = z.infer<typeof PlantFormSchema>;

export const SunNeedSchema = z.enum(['full', 'part', 'shade']);
export type SunNeed = z.infer<typeof SunNeedSchema>;

export const HardinessSchema = z.enum(['H3', 'H4', 'H5', 'H6', 'H7']);
export type Hardiness = z.infer<typeof HardinessSchema>;

export const PlantSpeciesSchema = z.object({
  id: z.string(),
  common: z.string(),
  botanical: z.string(),
  form: PlantFormSchema,
  /** How a tree or a shrub is placed on its own — its footprint and fallback drawing. */
  symbol: z.string().optional(),
  /** An existing sprite, pinned: the family id and a 1-based variant. */
  art: z.object({ family: z.string(), variant: z.number().int().min(1) }),
  /** Metres, as it will be in a garden in `yearsToMature` years, not the botanical maximum. */
  matureHeight: z.number().positive(),
  matureSpread: z.number().positive(),
  yearsToMature: z.number().int().positive(),
  /** The light it grows in. More than one means it is content in any of them. */
  sun: z.array(SunNeedSchema).min(1),
  evergreen: z.boolean(),
  /** Months it flowers in, 1–12. Empty for a plant grown for its leaves or its shape. */
  flowering: z.array(z.number().int().min(1).max(12)),
  /** Planting centres in metres when grown in a group or a hedge. */
  spacing: z.number().positive(),
  hardiness: HardinessSchema,
  maintenance: MaintenanceLevelSchema,
  tags: z.array(z.string()),
});
export type PlantSpecies = z.infer<typeof PlantSpeciesSchema>;

type Facts = {
  h: number;
  w: number;
  years: number;
  sun: SunNeed[];
  evergreen?: boolean;
  flowers?: number[];
  spacing: number;
  hardy: Hardiness;
  upkeep: MaintenanceLevel;
  tags?: string[];
  symbol?: SymbolId;
};

function plant(
  id: string,
  common: string,
  botanical: string,
  form: PlantForm,
  family: string,
  variant: number,
  facts: Facts,
): PlantSpecies {
  return {
    id,
    common,
    botanical,
    form,
    ...(facts.symbol ? { symbol: facts.symbol } : {}),
    art: { family, variant },
    matureHeight: facts.h,
    matureSpread: facts.w,
    yearsToMature: facts.years,
    sun: facts.sun,
    evergreen: facts.evergreen ?? false,
    flowering: facts.flowers ?? [],
    spacing: facts.spacing,
    hardiness: facts.hardy,
    maintenance: facts.upkeep,
    tags: facts.tags ?? [],
  };
}

const FULL: SunNeed[] = ['full'];
const FULL_PART: SunNeed[] = ['full', 'part'];
const ANY_LIGHT: SunNeed[] = ['full', 'part', 'shade'];
const PART_SHADE: SunNeed[] = ['part', 'shade'];

export const PLANT_SPECIES: PlantSpecies[] = [
  /* ---------------------------------------------------------------- trees */
  plant('betula-pendula', 'Silver birch', 'Betula pendula', 'tree', 'tree-canopy', 1, {
    h: 10, w: 5, years: 20, sun: FULL_PART, spacing: 5, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'wildlife', 'light-canopy'], symbol: 'tree-deciduous',
  }),
  plant('betula-utilis-jacquemontii', 'Himalayan birch (multi-stem)', 'Betula utilis var. jacquemontii', 'tree', 'tree-multistem', 1, {
    h: 8, w: 4, years: 20, sun: FULL_PART, spacing: 4, hardy: 'H7', upkeep: 'low',
    tags: ['white-bark', 'light-canopy'], symbol: 'tree-multistem',
  }),
  plant('sorbus-aucuparia', 'Rowan', 'Sorbus aucuparia', 'tree', 'tree-canopy', 2, {
    h: 8, w: 4, years: 20, sun: FULL_PART, flowers: [5], spacing: 4, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'wildlife', 'berries'], symbol: 'tree-deciduous',
  }),
  plant('crataegus-monogyna', 'Hawthorn', 'Crataegus monogyna', 'tree', 'tree-canopy', 2, {
    h: 6, w: 5, years: 20, sun: FULL_PART, flowers: [5], spacing: 4, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'wildlife', 'berries'], symbol: 'tree-deciduous',
  }),
  plant('acer-campestre', 'Field maple', 'Acer campestre', 'tree', 'tree-canopy', 4, {
    h: 10, w: 6, years: 20, sun: FULL_PART, spacing: 5, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'autumn-colour'], symbol: 'tree-deciduous',
  }),
  plant('carpinus-betulus-fastigiata', 'Upright hornbeam', "Carpinus betulus 'Fastigiata'", 'tree', 'tree-canopy', 4, {
    h: 10, w: 4, years: 20, sun: ANY_LIGHT, spacing: 4, hardy: 'H7', upkeep: 'low',
    tags: ['formal', 'screening'], symbol: 'tree-deciduous',
  }),
  plant('prunus-tai-haku', 'Great white cherry', "Prunus 'Tai-haku'", 'tree', 'tree-canopy', 6, {
    h: 8, w: 8, years: 20, sun: FULL, flowers: [4], spacing: 6, hardy: 'H6', upkeep: 'low',
    tags: ['blossom'], symbol: 'tree-deciduous',
  }),
  plant('amelanchier-lamarckii', 'Snowy mespilus', 'Amelanchier lamarckii', 'tree', 'tree-multistem', 2, {
    h: 6, w: 5, years: 20, sun: FULL_PART, flowers: [4], spacing: 4, hardy: 'H7', upkeep: 'low',
    tags: ['blossom', 'autumn-colour', 'wildlife'], symbol: 'tree-multistem',
  }),
  plant('malus-evereste', "Crab apple 'Evereste'", "Malus 'Evereste'", 'tree', 'tree-ornamental', 2, {
    h: 6, w: 4, years: 20, sun: FULL_PART, flowers: [4, 5], spacing: 4, hardy: 'H6', upkeep: 'low',
    tags: ['blossom', 'wildlife', 'fruit'], symbol: 'tree-ornamental',
  }),
  plant('prunus-amanogawa', "Flowering cherry 'Amanogawa'", "Prunus 'Amanogawa'", 'tree', 'tree-ornamental', 1, {
    h: 6, w: 2, years: 20, sun: FULL, flowers: [4, 5], spacing: 3, hardy: 'H6', upkeep: 'low',
    tags: ['blossom', 'narrow'], symbol: 'tree-ornamental',
  }),
  plant('cercis-siliquastrum', 'Judas tree', 'Cercis siliquastrum', 'tree', 'tree-ornamental', 1, {
    h: 6, w: 5, years: 20, sun: FULL, flowers: [4, 5], spacing: 4, hardy: 'H5', upkeep: 'low',
    tags: ['blossom'], symbol: 'tree-ornamental',
  }),
  plant('magnolia-stellata', 'Star magnolia', 'Magnolia stellata', 'tree', 'tree-ornamental', 3, {
    h: 3, w: 4, years: 20, sun: FULL_PART, flowers: [3, 4], spacing: 3, hardy: 'H5', upkeep: 'low',
    tags: ['blossom'], symbol: 'tree-ornamental',
  }),
  plant('acer-palmatum-red', 'Japanese maple', 'Acer palmatum', 'tree', 'tree-japanese-maple', 1, {
    h: 3, w: 4, years: 20, sun: FULL_PART, spacing: 3, hardy: 'H6', upkeep: 'medium',
    tags: ['autumn-colour', 'red-leaf'], symbol: 'tree-ornamental',
  }),
  plant('acer-palmatum-dissectum', 'Cut-leaf Japanese maple', 'Acer palmatum var. dissectum', 'tree', 'tree-japanese-maple', 3, {
    h: 2, w: 3, years: 20, sun: FULL_PART, spacing: 2.5, hardy: 'H6', upkeep: 'medium',
    tags: ['autumn-colour', 'red-leaf'], symbol: 'tree-ornamental',
  }),
  plant('malus-domestica', 'Apple (dwarf rootstock)', 'Malus domestica', 'tree', 'tree-fruit', 1, {
    h: 3.5, w: 3.5, years: 8, sun: FULL, flowers: [4, 5], spacing: 3, hardy: 'H6', upkeep: 'medium',
    tags: ['edible', 'blossom'], symbol: 'tree-fruit',
  }),
  plant('pyrus-communis', 'Pear (dwarf rootstock)', 'Pyrus communis', 'tree', 'tree-fruit', 2, {
    h: 4, w: 3, years: 8, sun: FULL, flowers: [4], spacing: 3, hardy: 'H6', upkeep: 'medium',
    tags: ['edible', 'blossom'], symbol: 'tree-fruit',
  }),
  plant('prunus-domestica', "Plum 'Victoria'", "Prunus domestica 'Victoria'", 'tree', 'tree-fruit', 1, {
    h: 4, w: 4, years: 8, sun: FULL, flowers: [4], spacing: 3.5, hardy: 'H6', upkeep: 'medium',
    tags: ['edible', 'blossom'], symbol: 'tree-fruit',
  }),
  plant('pinus-sylvestris', 'Scots pine', 'Pinus sylvestris', 'tree', 'tree-conifer', 1, {
    h: 12, w: 5, years: 25, sun: FULL, evergreen: true, spacing: 5, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'conifer'], symbol: 'tree-evergreen',
  }),
  plant('juniperus-skyrocket', "Juniper 'Skyrocket'", "Juniperus scopulorum 'Skyrocket'", 'tree', 'tree-conifer', 3, {
    h: 5, w: 1, years: 15, sun: FULL, evergreen: true, spacing: 1, hardy: 'H7', upkeep: 'low',
    tags: ['conifer', 'narrow', 'formal'], symbol: 'tree-evergreen',
  }),
  plant('taxus-baccata-fastigiata', 'Irish yew', "Taxus baccata 'Fastigiata'", 'tree', 'tree-conifer', 2, {
    h: 5, w: 1.5, years: 20, sun: ANY_LIGHT, evergreen: true, spacing: 1.5, hardy: 'H7', upkeep: 'low',
    tags: ['conifer', 'narrow', 'formal'], symbol: 'tree-evergreen',
  }),

  /* ---------------------------------------------------------------- hedging */
  plant('fagus-sylvatica-hedge', 'Beech hedge', 'Fagus sylvatica', 'hedge', 'hedge-crown-beech', 1, {
    h: 1.8, w: 0.6, years: 6, sun: FULL_PART, spacing: 0.33, hardy: 'H7', upkeep: 'medium',
    tags: ['native', 'hedging', 'screening', 'keeps-dead-leaves'],
  }),
  plant('carpinus-betulus-hedge', 'Hornbeam hedge', 'Carpinus betulus', 'hedge', 'hedge-crown-beech', 2, {
    h: 1.8, w: 0.6, years: 6, sun: ANY_LIGHT, spacing: 0.33, hardy: 'H7', upkeep: 'medium',
    tags: ['native', 'hedging', 'screening'],
  }),
  plant('taxus-baccata-hedge', 'Yew hedge', 'Taxus baccata', 'hedge', 'hedge-crown-yew', 1, {
    h: 1.8, w: 0.6, years: 8, sun: ANY_LIGHT, evergreen: true, spacing: 0.5, hardy: 'H7', upkeep: 'medium',
    tags: ['native', 'hedging', 'screening', 'formal'],
  }),
  plant('ligustrum-ovalifolium', 'Privet hedge', 'Ligustrum ovalifolium', 'hedge', 'hedge-crown-yew', 2, {
    h: 1.8, w: 0.6, years: 4, sun: FULL_PART, evergreen: true, flowers: [7], spacing: 0.33, hardy: 'H6', upkeep: 'high',
    tags: ['hedging', 'screening'],
  }),
  plant('prunus-laurocerasus', 'Cherry laurel hedge', 'Prunus laurocerasus', 'hedge', 'hedge-crown-yew', 2, {
    h: 2, w: 1, years: 4, sun: ANY_LIGHT, evergreen: true, flowers: [4], spacing: 0.6, hardy: 'H5', upkeep: 'medium',
    tags: ['hedging', 'screening'],
  }),
  plant('crataegus-hedge', 'Hawthorn hedge', 'Crataegus monogyna', 'hedge', 'hedge-crown-beech', 1, {
    h: 1.5, w: 0.6, years: 5, sun: FULL_PART, flowers: [5], spacing: 0.3, hardy: 'H7', upkeep: 'medium',
    tags: ['native', 'hedging', 'wildlife'],
  }),
  plant('buxus-sempervirens-hedge', 'Box edging', 'Buxus sempervirens', 'hedge', 'plant-shrub-topiary', 1, {
    h: 0.5, w: 0.3, years: 6, sun: ANY_LIGHT, evergreen: true, spacing: 0.25, hardy: 'H6', upkeep: 'high',
    tags: ['hedging', 'formal', 'low-hedge'],
  }),

  /* ---------------------------------------------------------------- shrubs */
  plant('pittosporum-tenuifolium', 'Pittosporum', 'Pittosporum tenuifolium', 'shrub', 'plant-shrub', 1, {
    h: 3, w: 2, years: 10, sun: FULL_PART, evergreen: true, flowers: [5], spacing: 1.5, hardy: 'H4', upkeep: 'low',
    tags: ['screening'], symbol: 'shrub-evergreen',
  }),
  plant('choisya-ternata', 'Mexican orange blossom', 'Choisya ternata', 'shrub', 'plant-shrub', 2, {
    h: 2, w: 2, years: 8, sun: FULL_PART, evergreen: true, flowers: [4, 5, 9], spacing: 1.2, hardy: 'H4', upkeep: 'low',
    tags: ['scented'], symbol: 'shrub-evergreen',
  }),
  plant('viburnum-tinus', 'Laurustinus', 'Viburnum tinus', 'shrub', 'plant-shrub', 3, {
    h: 2.5, w: 2.5, years: 10, sun: ANY_LIGHT, evergreen: true, flowers: [12, 1, 2, 3, 4], spacing: 1.2, hardy: 'H5', upkeep: 'low',
    tags: ['winter-interest', 'screening'], symbol: 'shrub-evergreen',
  }),
  plant('hebe-rakaiensis', 'Hebe', 'Hebe rakaiensis', 'shrub', 'plant-shrub', 4, {
    h: 0.9, w: 1.2, years: 5, sun: FULL_PART, evergreen: true, flowers: [6, 7], spacing: 0.8, hardy: 'H5', upkeep: 'low',
    tags: ['compact'], symbol: 'shrub-evergreen',
  }),
  plant('euonymus-fortunei', 'Euonymus', "Euonymus fortunei 'Emerald 'n' Gold'", 'shrub', 'plant-shrub', 5, {
    h: 0.6, w: 1.2, years: 5, sun: ANY_LIGHT, evergreen: true, spacing: 0.6, hardy: 'H5', upkeep: 'low',
    tags: ['compact', 'variegated'], symbol: 'shrub-evergreen',
  }),
  plant('cornus-alba', 'Red-barked dogwood', "Cornus alba 'Sibirica'", 'shrub', 'plant-shrub', 6, {
    h: 2, w: 2, years: 5, sun: FULL_PART, flowers: [5, 6], spacing: 1, hardy: 'H7', upkeep: 'low',
    tags: ['winter-interest'], symbol: 'shrub-flowering',
  }),
  plant('sarcococca-confusa', 'Christmas box', 'Sarcococca confusa', 'shrub', 'plant-shrub', 5, {
    h: 1, w: 1, years: 8, sun: PART_SHADE, evergreen: true, flowers: [12, 1, 2], spacing: 0.8, hardy: 'H5', upkeep: 'low',
    tags: ['scented', 'winter-interest', 'shade'], symbol: 'shrub-evergreen',
  }),
  plant('skimmia-japonica', 'Skimmia', 'Skimmia japonica', 'shrub', 'plant-shrub', 2, {
    h: 1, w: 1, years: 8, sun: PART_SHADE, evergreen: true, flowers: [3, 4], spacing: 0.8, hardy: 'H5', upkeep: 'low',
    tags: ['berries', 'shade'], symbol: 'shrub-evergreen',
  }),
  plant('pieris-japonica', 'Pieris', 'Pieris japonica', 'shrub', 'plant-shrub', 1, {
    h: 2, w: 2, years: 10, sun: ['part'], evergreen: true, flowers: [3, 4], spacing: 1.2, hardy: 'H5', upkeep: 'medium',
    tags: ['acid-soil'], symbol: 'shrub-evergreen',
  }),
  plant('osmanthus-burkwoodii', 'Osmanthus', 'Osmanthus × burkwoodii', 'shrub', 'plant-shrub', 3, {
    h: 2.5, w: 2.5, years: 10, sun: FULL_PART, evergreen: true, flowers: [4, 5], spacing: 1.2, hardy: 'H5', upkeep: 'low',
    tags: ['scented', 'screening'], symbol: 'shrub-evergreen',
  }),
  plant('cistus-purpureus', 'Rock rose', 'Cistus × purpureus', 'shrub', 'plant-shrub', 4, {
    h: 1, w: 1, years: 4, sun: FULL, evergreen: true, flowers: [6, 7], spacing: 0.8, hardy: 'H4', upkeep: 'low',
    tags: ['drought-tolerant'], symbol: 'shrub-evergreen',
  }),
  plant('rosmarinus-officinalis', 'Rosemary', 'Salvia rosmarinus', 'shrub', 'plant-shrub', 4, {
    h: 1, w: 1, years: 4, sun: FULL, evergreen: true, flowers: [4, 5], spacing: 0.6, hardy: 'H4', upkeep: 'low',
    tags: ['edible', 'scented', 'drought-tolerant', 'pollinator'], symbol: 'shrub-evergreen',
  }),
  plant('philadelphus-belle-etoile', 'Mock orange', "Philadelphus 'Belle Étoile'", 'shrub', 'plant-shrub-deciduous', 1, {
    h: 1.5, w: 1.5, years: 6, sun: FULL_PART, flowers: [6, 7], spacing: 1.2, hardy: 'H6', upkeep: 'low',
    tags: ['scented'], symbol: 'shrub-flowering',
  }),
  plant('weigela-florida', 'Weigela', 'Weigela florida', 'shrub', 'plant-shrub-deciduous', 2, {
    h: 1.5, w: 1.5, years: 6, sun: FULL_PART, flowers: [5, 6], spacing: 1.2, hardy: 'H6', upkeep: 'low',
    tags: [], symbol: 'shrub-flowering',
  }),
  plant('hydrangea-macrophylla', 'Mophead hydrangea', 'Hydrangea macrophylla', 'shrub', 'plant-shrub-deciduous', 3, {
    h: 1.5, w: 1.5, years: 6, sun: ['part', 'full'], flowers: [7, 8, 9], spacing: 1.2, hardy: 'H5', upkeep: 'medium',
    tags: [], symbol: 'shrub-flowering',
  }),
  plant('hydrangea-paniculata', "Hydrangea 'Limelight'", "Hydrangea paniculata 'Limelight'", 'shrub', 'plant-shrub-deciduous', 3, {
    h: 2, w: 2, years: 6, sun: FULL_PART, flowers: [8, 9, 10], spacing: 1.2, hardy: 'H6', upkeep: 'low',
    tags: [], symbol: 'shrub-flowering',
  }),
  plant('buddleja-davidii', 'Butterfly bush', 'Buddleja davidii', 'shrub', 'plant-shrub-deciduous', 2, {
    h: 3, w: 3, years: 3, sun: FULL, flowers: [7, 8, 9], spacing: 1.5, hardy: 'H6', upkeep: 'medium',
    tags: ['pollinator', 'wildlife'], symbol: 'shrub-flowering',
  }),
  plant('spiraea-japonica', 'Spiraea', "Spiraea japonica 'Goldflame'", 'shrub', 'plant-shrub-deciduous', 2, {
    h: 1, w: 1, years: 4, sun: FULL_PART, flowers: [6, 7], spacing: 0.8, hardy: 'H6', upkeep: 'low',
    tags: ['compact'], symbol: 'shrub-flowering',
  }),
  plant('rosa-rugosa', 'Rugosa rose', 'Rosa rugosa', 'shrub', 'plant-shrub-deciduous', 2, {
    h: 1.5, w: 1.5, years: 4, sun: FULL, flowers: [6, 7, 8, 9], spacing: 1, hardy: 'H7', upkeep: 'low',
    tags: ['scented', 'pollinator', 'hips'], symbol: 'shrub-flowering',
  }),
  plant('cotinus-coggygria', 'Smoke bush', "Cotinus coggygria 'Royal Purple'", 'shrub', 'plant-shrub-deciduous', 2, {
    h: 3, w: 3, years: 8, sun: FULL, flowers: [6, 7], spacing: 1.5, hardy: 'H5', upkeep: 'low',
    tags: ['autumn-colour', 'purple-leaf'], symbol: 'shrub-flowering',
  }),
  plant('fatsia-japonica', 'Japanese aralia', 'Fatsia japonica', 'shrub', 'plant-shrub-architectural', 1, {
    h: 3, w: 3, years: 10, sun: PART_SHADE, evergreen: true, flowers: [10, 11], spacing: 1.5, hardy: 'H5', upkeep: 'low',
    tags: ['architectural', 'shade'], symbol: 'shrub-architectural',
  }),
  plant('phormium-tenax', 'New Zealand flax', 'Phormium tenax', 'shrub', 'plant-shrub-architectural', 2, {
    h: 2, w: 1.5, years: 6, sun: FULL_PART, evergreen: true, flowers: [7], spacing: 1, hardy: 'H4', upkeep: 'low',
    tags: ['architectural'], symbol: 'shrub-architectural',
  }),
  plant('cordyline-australis', 'Cabbage palm', 'Cordyline australis', 'shrub', 'plant-shrub-architectural', 2, {
    h: 4, w: 1.5, years: 10, sun: FULL, evergreen: true, spacing: 1.2, hardy: 'H3', upkeep: 'low',
    tags: ['architectural'], symbol: 'shrub-architectural',
  }),
  plant('yucca-filamentosa', "Adam's needle", 'Yucca filamentosa', 'shrub', 'plant-shrub-architectural', 3, {
    h: 1, w: 1, years: 6, sun: FULL, evergreen: true, flowers: [7, 8], spacing: 0.8, hardy: 'H5', upkeep: 'low',
    tags: ['architectural', 'drought-tolerant'], symbol: 'shrub-architectural',
  }),
  plant('buxus-ball', 'Box ball', 'Buxus sempervirens (clipped)', 'shrub', 'plant-shrub-topiary', 1, {
    h: 0.6, w: 0.6, years: 6, sun: ANY_LIGHT, evergreen: true, spacing: 0.6, hardy: 'H6', upkeep: 'high',
    tags: ['formal', 'topiary'], symbol: 'shrub-topiary',
  }),
  plant('ilex-crenata-ball', 'Japanese holly ball', 'Ilex crenata (clipped)', 'shrub', 'plant-shrub-topiary', 1, {
    h: 0.6, w: 0.6, years: 6, sun: ANY_LIGHT, evergreen: true, spacing: 0.6, hardy: 'H6', upkeep: 'medium',
    tags: ['formal', 'topiary'], symbol: 'shrub-topiary',
  }),
  plant('taxus-cone', 'Yew cone', 'Taxus baccata (clipped)', 'shrub', 'plant-shrub-topiary', 2, {
    h: 1.5, w: 0.8, years: 10, sun: ANY_LIGHT, evergreen: true, spacing: 0.8, hardy: 'H7', upkeep: 'high',
    tags: ['formal', 'topiary'], symbol: 'shrub-topiary',
  }),

  /* ---------------------------------------------------------------- perennials */
  plant('lavandula-hidcote', "Lavender 'Hidcote'", "Lavandula angustifolia 'Hidcote'", 'perennial', 'plant-perennial', 1, {
    h: 0.5, w: 0.6, years: 3, sun: FULL, evergreen: true, flowers: [6, 7, 8], spacing: 0.45, hardy: 'H5', upkeep: 'low',
    tags: ['pollinator', 'scented', 'drought-tolerant'],
  }),
  plant('salvia-caradonna', "Salvia 'Caradonna'", "Salvia nemorosa 'Caradonna'", 'perennial', 'plant-perennial', 2, {
    h: 0.6, w: 0.4, years: 2, sun: FULL, flowers: [6, 7, 8, 9], spacing: 0.4, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator'],
  }),
  plant('geranium-rozanne', "Cranesbill 'Rozanne'", "Geranium 'Rozanne'", 'perennial', 'plant-perennial', 3, {
    h: 0.5, w: 0.8, years: 2, sun: FULL_PART, flowers: [6, 7, 8, 9, 10], spacing: 0.5, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'long-flowering'],
  }),
  plant('echinacea-purpurea', 'Coneflower', 'Echinacea purpurea', 'perennial', 'plant-perennial', 4, {
    h: 1, w: 0.5, years: 2, sun: FULL, flowers: [7, 8, 9], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'prairie'],
  }),
  plant('nepeta-walkers-low', "Catmint 'Walker's Low'", "Nepeta × faassenii 'Walker's Low'", 'perennial', 'plant-perennial', 5, {
    h: 0.6, w: 0.6, years: 2, sun: FULL, flowers: [5, 6, 7, 8, 9], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'long-flowering'],
  }),
  plant('alchemilla-mollis', "Lady's mantle", 'Alchemilla mollis', 'perennial', 'plant-perennial', 6, {
    h: 0.5, w: 0.6, years: 2, sun: ANY_LIGHT, flowers: [6, 7], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['edging'],
  }),
  plant('rudbeckia-goldsturm', 'Black-eyed Susan', "Rudbeckia fulgida 'Goldsturm'", 'perennial', 'plant-perennial', 4, {
    h: 0.6, w: 0.45, years: 2, sun: FULL, flowers: [8, 9, 10], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'prairie'],
  }),
  plant('symphyotrichum-little-carlow', "Aster 'Little Carlow'", "Symphyotrichum 'Little Carlow'", 'perennial', 'plant-perennial', 4, {
    h: 0.9, w: 0.5, years: 2, sun: FULL_PART, flowers: [9, 10], spacing: 0.5, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'prairie'],
  }),
  plant('anemone-honorine-jobert', 'Japanese anemone', "Anemone × hybrida 'Honorine Jobert'", 'perennial', 'plant-perennial', 3, {
    h: 1.2, w: 0.6, years: 3, sun: ANY_LIGHT, flowers: [8, 9, 10], spacing: 0.5, hardy: 'H7', upkeep: 'low',
    tags: ['late-flowering'],
  }),
  plant('hylotelephium-autumn-joy', "Sedum 'Autumn Joy'", "Hylotelephium 'Herbstfreude'", 'perennial', 'plant-perennial', 6, {
    h: 0.6, w: 0.6, years: 2, sun: FULL, flowers: [8, 9, 10], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'drought-tolerant'],
  }),
  plant('erigeron-karvinskianus', 'Mexican fleabane', 'Erigeron karvinskianus', 'perennial', 'plant-perennial', 3, {
    h: 0.3, w: 0.6, years: 2, sun: FULL, flowers: [5, 6, 7, 8, 9, 10], spacing: 0.4, hardy: 'H4', upkeep: 'low',
    tags: ['long-flowering', 'edging'],
  }),
  plant('veronicastrum-virginicum', "Culver's root", 'Veronicastrum virginicum', 'perennial', 'plant-perennial-upright', 1, {
    h: 1.5, w: 0.5, years: 3, sun: FULL_PART, flowers: [7, 8, 9], spacing: 0.5, hardy: 'H7', upkeep: 'low',
    tags: ['pollinator', 'prairie'],
  }),
  plant('agastache-blue-fortune', "Giant hyssop 'Blue Fortune'", "Agastache 'Blue Fortune'", 'perennial', 'plant-perennial-upright', 2, {
    h: 0.9, w: 0.5, years: 2, sun: FULL, flowers: [7, 8, 9], spacing: 0.45, hardy: 'H5', upkeep: 'low',
    tags: ['pollinator', 'scented'],
  }),
  plant('verbena-bonariensis', 'Purpletop vervain', 'Verbena bonariensis', 'perennial', 'plant-perennial-upright', 2, {
    h: 1.5, w: 0.5, years: 1, sun: FULL, flowers: [7, 8, 9, 10], spacing: 0.45, hardy: 'H5', upkeep: 'low',
    tags: ['pollinator', 'see-through'],
  }),
  plant('persicaria-amplexicaulis', 'Red bistort', "Persicaria amplexicaulis 'Firetail'", 'perennial', 'plant-perennial-upright', 3, {
    h: 1.2, w: 1, years: 3, sun: FULL_PART, flowers: [7, 8, 9, 10], spacing: 0.6, hardy: 'H7', upkeep: 'low',
    tags: ['long-flowering'],
  }),
  plant('crocosmia-lucifer', "Montbretia 'Lucifer'", "Crocosmia 'Lucifer'", 'perennial', 'plant-perennial-upright', 3, {
    h: 1, w: 0.5, years: 2, sun: FULL_PART, flowers: [7, 8], spacing: 0.4, hardy: 'H6', upkeep: 'low',
    tags: [],
  }),
  plant('digitalis-purpurea', 'Foxglove', 'Digitalis purpurea', 'perennial', 'plant-perennial-spire', 1, {
    h: 1.5, w: 0.5, years: 2, sun: ANY_LIGHT, flowers: [6, 7], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'pollinator', 'woodland', 'self-seeds'],
  }),
  plant('lupinus-russell', 'Lupin', 'Lupinus Russell hybrids', 'perennial', 'plant-perennial-spire', 2, {
    h: 1, w: 0.5, years: 2, sun: FULL_PART, flowers: [6, 7], spacing: 0.5, hardy: 'H7', upkeep: 'medium',
    tags: ['cottage'],
  }),
  plant('delphinium-elatum', 'Delphinium', 'Delphinium elatum hybrids', 'perennial', 'plant-perennial-spire', 3, {
    h: 1.8, w: 0.6, years: 2, sun: FULL, flowers: [6, 7], spacing: 0.6, hardy: 'H7', upkeep: 'high',
    tags: ['cottage', 'needs-staking'],
  }),
  plant('kniphofia-uvaria', 'Red hot poker', 'Kniphofia uvaria', 'perennial', 'plant-perennial-spire', 2, {
    h: 1.2, w: 0.6, years: 3, sun: FULL, flowers: [7, 8, 9], spacing: 0.6, hardy: 'H6', upkeep: 'low',
    tags: ['architectural'],
  }),
  plant('iris-sibirica', 'Siberian iris', 'Iris sibirica', 'perennial', 'plant-perennial-spire', 1, {
    h: 0.9, w: 0.6, years: 3, sun: FULL_PART, flowers: [5, 6], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['moist-soil'],
  }),
  plant('dryopteris-filix-mas', 'Male fern', 'Dryopteris filix-mas', 'perennial', 'plant-perennial-ferny', 1, {
    h: 1, w: 1, years: 3, sun: PART_SHADE, spacing: 0.6, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'woodland', 'shade'],
  }),
  plant('polystichum-setiferum', 'Soft shield fern', 'Polystichum setiferum', 'perennial', 'plant-perennial-ferny', 1, {
    h: 0.6, w: 0.9, years: 3, sun: PART_SHADE, evergreen: true, spacing: 0.6, hardy: 'H6', upkeep: 'low',
    tags: ['native', 'woodland', 'shade'],
  }),
  plant('astilbe-arendsii', 'Astilbe', 'Astilbe × arendsii', 'perennial', 'plant-perennial-ferny', 2, {
    h: 0.8, w: 0.5, years: 2, sun: PART_SHADE, flowers: [6, 7, 8], spacing: 0.45, hardy: 'H7', upkeep: 'medium',
    tags: ['moist-soil', 'shade'],
  }),
  plant('hosta-sieboldiana', 'Hosta', 'Hosta sieboldiana var. elegans', 'perennial', 'plant-perennial-ferny', 2, {
    h: 0.6, w: 1, years: 3, sun: PART_SHADE, flowers: [7], spacing: 0.6, hardy: 'H7', upkeep: 'medium',
    tags: ['shade', 'slug-prone'],
  }),
  plant('helleborus-orientalis', 'Lenten rose', 'Helleborus × hybridus', 'perennial', 'plant-perennial-ferny', 1, {
    h: 0.45, w: 0.45, years: 3, sun: PART_SHADE, evergreen: true, flowers: [2, 3, 4], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['winter-interest', 'shade', 'woodland'],
  }),
  plant('achillea-millefolium', 'Yarrow', 'Achillea millefolium', 'perennial', 'plant-perennial-ferny', 3, {
    h: 0.8, w: 0.6, years: 2, sun: FULL, flowers: [6, 7, 8, 9], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'pollinator', 'drought-tolerant'],
  }),

  /* ---------------------------------------------------------------- grasses */
  plant('stipa-tenuissima', 'Mexican feather grass', 'Nassella tenuissima', 'grass', 'plant-grass', 1, {
    h: 0.6, w: 0.4, years: 2, sun: FULL, flowers: [6, 7, 8, 9], spacing: 0.35, hardy: 'H4', upkeep: 'low',
    tags: ['drought-tolerant', 'movement'],
  }),
  plant('festuca-glauca', 'Blue fescue', 'Festuca glauca', 'grass', 'plant-grass', 2, {
    h: 0.3, w: 0.3, years: 2, sun: FULL, evergreen: true, spacing: 0.25, hardy: 'H5', upkeep: 'low',
    tags: ['edging', 'drought-tolerant'],
  }),
  plant('miscanthus-sinensis', 'Eulalia', "Miscanthus sinensis 'Morning Light'", 'grass', 'plant-grass', 3, {
    h: 1.5, w: 1, years: 3, sun: FULL, flowers: [8, 9, 10], spacing: 0.8, hardy: 'H6', upkeep: 'low',
    tags: ['winter-interest'],
  }),
  plant('carex-testacea', 'Orange sedge', 'Carex testacea', 'grass', 'plant-grass', 4, {
    h: 0.5, w: 0.6, years: 2, sun: FULL_PART, evergreen: true, spacing: 0.4, hardy: 'H4', upkeep: 'low',
    tags: ['low-maintenance'],
  }),
  plant('anemanthele-lessoniana', "Pheasant's tail grass", 'Anemanthele lessoniana', 'grass', 'plant-grass', 4, {
    h: 0.8, w: 1, years: 2, sun: FULL_PART, evergreen: true, flowers: [7, 8], spacing: 0.6, hardy: 'H4', upkeep: 'low',
    tags: ['movement', 'low-maintenance'],
  }),
  plant('pennisetum-hameln', "Fountain grass 'Hameln'", "Pennisetum alopecuroides 'Hameln'", 'grass', 'plant-grass', 5, {
    h: 0.6, w: 0.6, years: 2, sun: FULL, flowers: [8, 9, 10], spacing: 0.5, hardy: 'H5', upkeep: 'low',
    tags: ['prairie'],
  }),
  plant('calamagrostis-karl-foerster', "Feather reed grass 'Karl Foerster'", "Calamagrostis × acutiflora 'Karl Foerster'", 'grass', 'plant-grass-tall', 1, {
    h: 1.8, w: 0.6, years: 2, sun: FULL_PART, flowers: [6, 7, 8, 9], spacing: 0.6, hardy: 'H7', upkeep: 'low',
    tags: ['prairie', 'vertical', 'winter-interest'],
  }),
  plant('stipa-gigantea', 'Giant feather grass', 'Stipa gigantea', 'grass', 'plant-grass-tall', 1, {
    h: 2, w: 1, years: 3, sun: FULL, evergreen: true, flowers: [6, 7, 8], spacing: 1, hardy: 'H6', upkeep: 'low',
    tags: ['see-through', 'drought-tolerant'],
  }),
  plant('molinia-transparent', "Purple moor grass 'Transparent'", "Molinia caerulea subsp. arundinacea 'Transparent'", 'grass', 'plant-grass-tall', 2, {
    h: 2, w: 0.6, years: 3, sun: FULL_PART, flowers: [7, 8, 9], spacing: 0.6, hardy: 'H7', upkeep: 'low',
    tags: ['prairie', 'see-through'],
  }),
  plant('panicum-heavy-metal', "Switchgrass 'Heavy Metal'", "Panicum virgatum 'Heavy Metal'", 'grass', 'plant-grass-tall', 3, {
    h: 1.2, w: 0.6, years: 3, sun: FULL, flowers: [8, 9, 10], spacing: 0.6, hardy: 'H7', upkeep: 'low',
    tags: ['prairie', 'autumn-colour'],
  }),

  /* ---------------------------------------------------------------- groundcover */
  plant('vinca-minor', 'Lesser periwinkle', 'Vinca minor', 'groundcover', 'plant-ground-cover', 1, {
    h: 0.15, w: 0.9, years: 3, sun: ANY_LIGHT, evergreen: true, flowers: [3, 4, 5], spacing: 0.4, hardy: 'H6', upkeep: 'low',
    tags: ['shade', 'low-maintenance'],
  }),
  plant('ajuga-reptans', 'Bugle', "Ajuga reptans 'Atropurpurea'", 'groundcover', 'plant-ground-cover', 2, {
    h: 0.15, w: 0.6, years: 2, sun: ANY_LIGHT, evergreen: true, flowers: [4, 5, 6], spacing: 0.3, hardy: 'H7', upkeep: 'low',
    tags: ['native', 'pollinator'],
  }),
  plant('heuchera-palace-purple', "Heuchera 'Palace Purple'", "Heuchera micrantha var. diversifolia 'Palace Purple'", 'groundcover', 'plant-ground-cover', 3, {
    h: 0.45, w: 0.45, years: 2, sun: ANY_LIGHT, evergreen: true, flowers: [6, 7], spacing: 0.35, hardy: 'H7', upkeep: 'low',
    tags: ['purple-leaf', 'edging'],
  }),
  plant('pachysandra-terminalis', 'Japanese spurge', 'Pachysandra terminalis', 'groundcover', 'plant-ground-cover', 4, {
    h: 0.2, w: 0.6, years: 3, sun: PART_SHADE, evergreen: true, flowers: [4], spacing: 0.3, hardy: 'H5', upkeep: 'low',
    tags: ['shade', 'low-maintenance'],
  }),
  plant('geranium-macrorrhizum', 'Rock cranesbill', 'Geranium macrorrhizum', 'groundcover', 'plant-ground-cover-spreading', 1, {
    h: 0.4, w: 0.6, years: 2, sun: ANY_LIGHT, evergreen: true, flowers: [5, 6, 7], spacing: 0.45, hardy: 'H7', upkeep: 'low',
    tags: ['dry-shade', 'low-maintenance', 'scented-leaves'],
  }),
  plant('epimedium-rubrum', 'Barrenwort', 'Epimedium × rubrum', 'groundcover', 'plant-ground-cover-spreading', 2, {
    h: 0.3, w: 0.4, years: 3, sun: PART_SHADE, evergreen: true, flowers: [4, 5], spacing: 0.35, hardy: 'H7', upkeep: 'low',
    tags: ['dry-shade', 'woodland'],
  }),
  plant('lamium-white-nancy', "Dead nettle 'White Nancy'", "Lamium maculatum 'White Nancy'", 'groundcover', 'plant-ground-cover-spreading', 3, {
    h: 0.2, w: 0.6, years: 2, sun: PART_SHADE, flowers: [5, 6, 7], spacing: 0.35, hardy: 'H7', upkeep: 'low',
    tags: ['shade'],
  }),
  plant('brunnera-jack-frost', "Siberian bugloss 'Jack Frost'", "Brunnera macrophylla 'Jack Frost'", 'groundcover', 'plant-ground-cover-spreading', 3, {
    h: 0.4, w: 0.5, years: 3, sun: PART_SHADE, flowers: [4, 5], spacing: 0.4, hardy: 'H7', upkeep: 'low',
    tags: ['shade', 'woodland'],
  }),
  plant('thymus-serpyllum', 'Creeping thyme', 'Thymus serpyllum', 'groundcover', 'plant-ground-cover', 2, {
    h: 0.1, w: 0.4, years: 2, sun: FULL, evergreen: true, flowers: [6, 7], spacing: 0.3, hardy: 'H6', upkeep: 'low',
    tags: ['pollinator', 'scented', 'drought-tolerant', 'between-paving'],
  }),
];

/** One species by id. */
export const SPECIES_BY_ID: ReadonlyMap<string, PlantSpecies> = new Map(
  PLANT_SPECIES.map((species) => [species.id, species]),
);

export function speciesById(id: string | undefined): PlantSpecies | undefined {
  return id ? SPECIES_BY_ID.get(id) : undefined;
}

/**
 * The species a name means — "hornbeam", "a silver birch", "Japanese maple" — for the designer's
 * `add` and the garden assistant, neither of which can say an id. Exact common or botanical names
 * first, then the name contained in a species' common name, so "maple" finds the Japanese maple
 * rather than nothing. `form` narrows it: a hornbeam *tree* and a hornbeam *hedge* share a word.
 */
export function speciesNamed(name: string, forms?: PlantForm[]): PlantSpecies | undefined {
  const wanted = normalise(name);
  if (!wanted) return undefined;
  const pool = forms ? PLANT_SPECIES.filter((species) => forms.includes(species.form)) : PLANT_SPECIES;
  return (
    pool.find((species) => normalise(species.common) === wanted || normalise(species.botanical) === wanted) ??
    pool.find((species) => wanted.includes(normalise(species.common))) ??
    /*
     * The plant's own name inside a longer phrase — "an old apple tree by the fence" — by the common
     * name without its cultivar or its note, as whole words, the longest first so "crab apple" is
     * not taken for an apple.
     */
    pool
      .map((species) => ({ species, core: coreName(species.common) }))
      .filter(({ core }) => core.length > 2 && ` ${wanted} `.includes(` ${core} `))
      .sort((a, b) => b.core.length - a.core.length)[0]?.species ??
    pool.find((species) => normalise(species.common).includes(wanted)) ??
    pool.find((species) => normalise(species.botanical).split(' ')[0] === wanted.split(' ')[0])
  );
}

/** "Crab apple 'Evereste'" → "crab apple"; "Apple (dwarf rootstock)" → "apple". */
function coreName(common: string): string {
  return normalise(common.replace(/\(.*?\)/g, '').replace(/['‘’].*?['‘’]/g, ''));
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’"().×]/g, '')
    .replace(/\b(an?|the|some|three|two|four|five)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether a species is content in the light a place gets. */
export function suitsSun(species: PlantSpecies, light: SunNeed): boolean {
  return species.sun.includes(light);
}
