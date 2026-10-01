import { z } from 'zod';
import type { DesignElement } from '../concepts.js';
import type { MaintenanceLevel } from '../brief.js';
import { speciesById, type PlantSpecies, type SunNeed } from './species.js';

/**
 * What a bed is planted with: a mix of species and the share of the bed each takes.
 *
 * **A named mix is a planting-bed material.** "Shade woodland", "sunny gravel", "pollinator" — each
 * is a material a bed can be made of, beside the five it already had, so choosing one is the same
 * gesture as choosing gravel for a path, the schedule groups by it for free, and the designer's
 * `material` verb reaches it without a word added to its grammar. The five older materials carry no
 * species and draw exactly as they always did.
 *
 * **A bed may also have a mix of its own** — `DesignElement.planting` — which wins over its
 * material's. That is what somebody editing shares by hand writes; the material stays as the drawing
 * base the mix started from.
 *
 * Shares are of the bed's *area*, and each species is planted at its own `spacing`, so a count is
 * `ceil(area × share / spacing²)` — a number somebody can order, which the drawn density is not.
 */

export const MixEntrySchema = z.object({
  speciesId: z.string(),
  share: z.number().positive().max(1),
});
export type MixEntry = z.infer<typeof MixEntrySchema>;

/** A bed's own mix, overriding its material's. On `DesignElement.planting`. */
export const BedPlantingSchema = z.object({
  mix: z.array(MixEntrySchema).min(1).max(16),
});
export type BedPlanting = z.infer<typeof BedPlantingSchema>;

export interface PlantingMix {
  id: string;
  label: string;
  /** One sentence on where it belongs, for the palette and the designer's inventory. */
  suits: string;
  mix: MixEntry[];
}

/** The mixes, by material id. The ids are also in `MaterialIdSchema`, so a bed can be made of one. */
export const PLANTING_MIXES: Record<string, PlantingMix> = {
  'mix-shade-woodland': {
    id: 'mix-shade-woodland',
    label: 'Shade woodland mix',
    suits: 'A border in shade or under trees: ferns, foxgloves and hellebores over spreading groundcover.',
    mix: [
      { speciesId: 'dryopteris-filix-mas', share: 0.15 },
      { speciesId: 'polystichum-setiferum', share: 0.1 },
      { speciesId: 'digitalis-purpurea', share: 0.1 },
      { speciesId: 'astilbe-arendsii', share: 0.1 },
      { speciesId: 'hosta-sieboldiana', share: 0.1 },
      { speciesId: 'helleborus-orientalis', share: 0.1 },
      { speciesId: 'geranium-macrorrhizum', share: 0.15 },
      { speciesId: 'epimedium-rubrum', share: 0.1 },
      { speciesId: 'brunnera-jack-frost', share: 0.1 },
    ],
  },
  'mix-sunny-gravel': {
    id: 'mix-sunny-gravel',
    label: 'Sunny gravel mix',
    suits: 'A hot, dry, sunny bed: lavender, grasses and sedum that want little water.',
    mix: [
      { speciesId: 'lavandula-hidcote', share: 0.2 },
      { speciesId: 'stipa-tenuissima', share: 0.2 },
      { speciesId: 'festuca-glauca', share: 0.1 },
      { speciesId: 'hylotelephium-autumn-joy', share: 0.15 },
      { speciesId: 'erigeron-karvinskianus', share: 0.1 },
      { speciesId: 'achillea-millefolium', share: 0.1 },
      { speciesId: 'verbena-bonariensis', share: 0.1 },
      { speciesId: 'thymus-serpyllum', share: 0.05 },
    ],
  },
  'mix-pollinator': {
    id: 'mix-pollinator',
    label: 'Pollinator mix',
    suits: 'A sunny border for bees and butterflies, flowering from May to October.',
    mix: [
      { speciesId: 'salvia-caradonna', share: 0.15 },
      { speciesId: 'nepeta-walkers-low', share: 0.15 },
      { speciesId: 'echinacea-purpurea', share: 0.15 },
      { speciesId: 'agastache-blue-fortune', share: 0.1 },
      { speciesId: 'verbena-bonariensis', share: 0.1 },
      { speciesId: 'achillea-millefolium', share: 0.1 },
      { speciesId: 'geranium-rozanne', share: 0.1 },
      { speciesId: 'digitalis-purpurea', share: 0.05 },
      { speciesId: 'lavandula-hidcote', share: 0.1 },
    ],
  },
  'mix-cottage-border': {
    id: 'mix-cottage-border',
    label: 'Cottage border mix',
    suits: 'A classic mixed border in sun: spires, roses and soft mounds, full from June.',
    mix: [
      { speciesId: 'geranium-rozanne', share: 0.15 },
      { speciesId: 'alchemilla-mollis', share: 0.1 },
      { speciesId: 'lupinus-russell', share: 0.1 },
      { speciesId: 'delphinium-elatum', share: 0.05 },
      { speciesId: 'digitalis-purpurea', share: 0.1 },
      { speciesId: 'nepeta-walkers-low', share: 0.1 },
      { speciesId: 'salvia-caradonna', share: 0.1 },
      { speciesId: 'anemone-honorine-jobert', share: 0.1 },
      { speciesId: 'echinacea-purpurea', share: 0.1 },
      { speciesId: 'rosa-rugosa', share: 0.05 },
      { speciesId: 'philadelphus-belle-etoile', share: 0.05 },
    ],
  },
  'mix-prairie-grasses': {
    id: 'mix-prairie-grasses',
    label: 'Prairie grasses mix',
    suits: 'A naturalistic sunny planting of tall grasses and late daisies that stands through winter.',
    mix: [
      { speciesId: 'calamagrostis-karl-foerster', share: 0.15 },
      { speciesId: 'molinia-transparent', share: 0.15 },
      { speciesId: 'panicum-heavy-metal', share: 0.1 },
      { speciesId: 'pennisetum-hameln', share: 0.1 },
      { speciesId: 'echinacea-purpurea', share: 0.15 },
      { speciesId: 'rudbeckia-goldsturm', share: 0.1 },
      { speciesId: 'veronicastrum-virginicum', share: 0.1 },
      { speciesId: 'persicaria-amplexicaulis', share: 0.05 },
      { speciesId: 'symphyotrichum-little-carlow', share: 0.1 },
    ],
  },
  'mix-evergreen-structure': {
    id: 'mix-evergreen-structure',
    label: 'Evergreen structure mix',
    suits: 'A border that looks the same all year: evergreen shrubs, clipped balls and sedge.',
    mix: [
      { speciesId: 'pittosporum-tenuifolium', share: 0.15 },
      { speciesId: 'choisya-ternata', share: 0.15 },
      { speciesId: 'viburnum-tinus', share: 0.15 },
      { speciesId: 'hebe-rakaiensis', share: 0.15 },
      { speciesId: 'euonymus-fortunei', share: 0.1 },
      { speciesId: 'buxus-ball', share: 0.1 },
      { speciesId: 'carex-testacea', share: 0.1 },
      { speciesId: 'heuchera-palace-purple', share: 0.1 },
    ],
  },
  'mix-low-maintenance': {
    id: 'mix-low-maintenance',
    label: 'Low-maintenance mix',
    suits: 'A bed that asks for a tidy once a year: tough evergreens over groundcover that smothers weeds.',
    mix: [
      { speciesId: 'hebe-rakaiensis', share: 0.2 },
      { speciesId: 'euonymus-fortunei', share: 0.15 },
      { speciesId: 'geranium-macrorrhizum', share: 0.2 },
      { speciesId: 'vinca-minor', share: 0.15 },
      { speciesId: 'carex-testacea', share: 0.1 },
      { speciesId: 'anemanthele-lessoniana', share: 0.1 },
      { speciesId: 'hylotelephium-autumn-joy', share: 0.1 },
    ],
  },
};

export const PLANTING_MIX_IDS = Object.keys(PLANTING_MIXES);

export function isPlantingMix(materialId: string | undefined): boolean {
  return materialId !== undefined && materialId in PLANTING_MIXES;
}

/**
 * A bed's mix: its own if it has one, else its material's, else none — the five older planting
 * materials name a kind of planting, not species, and say nothing rather than guess.
 */
export function bedMix(element: Pick<DesignElement, 'planting' | 'material'>): MixEntry[] | null {
  if (element.planting && element.planting.mix.length > 0) return element.planting.mix;
  const preset = element.material ? PLANTING_MIXES[element.material] : undefined;
  return preset ? preset.mix : null;
}

/** A mix with its shares scaled to sum to one, and anything unknown dropped. */
export function normalisedMix(mix: MixEntry[]): MixEntry[] {
  const known = mix.filter((entry) => speciesById(entry.speciesId) && entry.share > 0);
  const total = known.reduce((sum, entry) => sum + entry.share, 0);
  if (total <= 0) return [];
  return known.map((entry) => ({ speciesId: entry.speciesId, share: entry.share / total }));
}

export interface MixLine {
  species: PlantSpecies;
  share: number;
  /** Plants to buy for this bed: area × share / spacing², rounded up. */
  count: number;
}

/** What a mix comes to in a bed of `areaSqm`: one line per species, with a count to order. */
export function mixCounts(mix: MixEntry[], areaSqm: number): MixLine[] {
  return normalisedMix(mix).map((entry) => {
    const species = speciesById(entry.speciesId)!;
    return {
      species,
      share: entry.share,
      count: areaSqm > 0 ? Math.ceil((areaSqm * entry.share) / (species.spacing * species.spacing)) : 0,
    };
  });
}

/** The most demanding upkeep any species in a mix asks for. */
export function mixMaintenance(mix: MixEntry[]): MaintenanceLevel {
  const order: MaintenanceLevel[] = ['low', 'medium', 'high'];
  return normalisedMix(mix).reduce<MaintenanceLevel>((worst, entry) => {
    const level = speciesById(entry.speciesId)!.maintenance;
    return order.indexOf(level) > order.indexOf(worst) ? level : worst;
  }, 'low');
}

/**
 * The species in a mix that will struggle in `light`, and what share of the bed they take — the
 * suitability badge's answer. Empty when everything suits.
 */
export function unsuitedTo(mix: MixEntry[], light: SunNeed): MixEntry[] {
  return normalisedMix(mix).filter((entry) => !speciesById(entry.speciesId)!.sun.includes(light));
}

/*
 * Editing a mix by hand. Shares are always kept summing to one, and a change to one species is taken
 * from — or given back to — the others in proportion, so "make the lavender a third" leaves the rest
 * of the bed in the balance it was in. The alternative, shares that do not sum to one until somebody
 * fixes them, is a bed the counts and the drawing would each read differently.
 */

/** `speciesId` at `share` of the bed, the rest scaled to fill what is left. */
export function withShare(mix: MixEntry[], speciesId: string, share: number): MixEntry[] {
  const current = normalisedMix(mix);
  if (!current.some((entry) => entry.speciesId === speciesId)) return current;
  if (current.length === 1) return [{ speciesId, share: 1 }];
  const wanted = Math.min(0.95, Math.max(0.05, share));
  const others = current.filter((entry) => entry.speciesId !== speciesId);
  const othersTotal = others.reduce((sum, entry) => sum + entry.share, 0);
  return current.map((entry) =>
    entry.speciesId === speciesId
      ? { speciesId, share: wanted }
      : {
          speciesId: entry.speciesId,
          share: othersTotal > 0 ? (entry.share / othersTotal) * (1 - wanted) : (1 - wanted) / others.length,
        },
  );
}

/** A species joined to the mix at an equal share, everything else scaled down to make room. */
export function withSpecies(mix: MixEntry[], speciesId: string): MixEntry[] {
  const current = normalisedMix(mix);
  if (!speciesById(speciesId) || current.some((entry) => entry.speciesId === speciesId)) return current;
  if (current.length >= 16) return current;
  const share = 1 / (current.length + 1);
  return [...current.map((entry) => ({ ...entry, share: entry.share * (1 - share) })), { speciesId, share }];
}

/** A species taken out, its share given back to the rest. Never leaves a bed with nothing in it. */
export function withoutSpecies(mix: MixEntry[], speciesId: string): MixEntry[] {
  const current = normalisedMix(mix);
  if (current.length <= 1) return current;
  return normalisedMix(current.filter((entry) => entry.speciesId !== speciesId));
}

/**
 * The preset a mix is a copy of, if it is one. A generated bed carries its mix on `planting` so its
 * material can stay what the scorer reads, and a panel that called that "its own mix" would be
 * describing an edit nobody made.
 */
export function presetMatching(mix: MixEntry[]): PlantingMix | null {
  const mine = normalisedMix(mix);
  for (const preset of Object.values(PLANTING_MIXES)) {
    const theirs = normalisedMix(preset.mix);
    if (
      theirs.length === mine.length &&
      theirs.every((entry, index) => entry.speciesId === mine[index]!.speciesId && Math.abs(entry.share - mine[index]!.share) < 1e-6)
    ) {
      return preset;
    }
  }
  return null;
}
