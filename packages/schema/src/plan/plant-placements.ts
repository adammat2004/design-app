import { boundingBox, type Point } from '../geometry/primitives.js';
import { elementOutline, type DesignElement } from './concepts.js';
import { MM_PER_METRE, type MaterialPattern } from './material-patterns.js';
import { MATERIALS } from './materials.js';
import { bedMix, normalisedMix } from './plants/mixes.js';
import { speciesById, type PlantSpecies } from './plants/species.js';
import { cellSize, distanceToEdge, samplePlanting } from './planting-sample.js';
import {
  isStructuralRole,
  schemeFor,
  type PlantingLayer,
  type PlantingRole,
  type PlantingScheme,
} from './planting.js';
import { moduleRandom } from './prng.js';

/**
 * Where a bed's infill plants stand, how big they are and how tall — the geometry half of drawing a
 * bed's planting, with no picture in it.
 *
 * ## Why it lives here
 *
 * It was the first half of the web's `buildPlants`, interleaved with choosing a sprite for each
 * plant. The 2D plan, the 3D editor and the AR scene builder all need the same plants in the same
 * places, and only the first of those draws sprites — so the placement is here, pure and
 * browser-free, and the web keeps what a plant *looks like* (`buildPlants` joins this to its asset
 * catalogue and palette).
 *
 * ## The split cannot move a plant
 *
 * Every random draw is made by `samplePlanting` or `plantingClusterAt`, in the order they always
 * were. The presentation half only *reads* draws already made (`draws.variant`, `draws.flower`,
 * `draws.family`), so nothing it decides can shift the sequence. The web pins that by hashing every
 * plant of every fixture scene before and after.
 */

/** A scatter pattern: the band of drawn sizes and the blob's shape. */
export type ScatterPattern = Extract<MaterialPattern, { patternType: 'scatter' }>;

/** One planting layer of a bed, as data: what to plant, and the size band it is drawn within. */
export interface PlacementLayer {
  planting: PlantingLayer;
  pattern: ScatterPattern;
}

export interface PlacedPlant {
  /** `bedId:role:col,row` — stable by construction: a world cell, a bed and a role. */
  id: string;
  /** World metres. */
  at: Point;
  /** Metres across, as drawn (the crown at maturity). */
  spread: number;
  /** Metres. */
  height: number;
  /** Radians. */
  rotation: number;
  /** Which palette tone, as a unit interval. */
  tone: number;
  /**
   * Unit intervals the sampler already drew, for a renderer's own choices — which variant, whether
   * in flower, which family of a drift. Reading them costs no draw and so cannot shift a plant.
   */
  draws: { variant: number; flower: number; family: number };
  /** Index into the layers passed in, or the understorey this module adds. */
  layer: number | 'understorey';
  role: PlantingRole;
  /** The layer's taxon type, first of a list. */
  taxonType: string;
  /** The layer's seed: the bed's id, salted by the layer's index. */
  seed: string;
  /** The bed it stands in. */
  hostId: string;
}

/**
 * How much denser instanced planting is than the texture it replaces.
 *
 * The scheme `share` values were tuned against the *painted* bed, where a unit is a soft-edged
 * blob that bleeds into its neighbours and the soil behind it is a tinted texture. A sprite is a
 * hard-edged photograph on a visible ground, so the same share reads as plants scattered on mulch
 * — which is exactly the "few plants on soil" appearance this work exists to remove.
 *
 * It is a **presentation gain and nothing else.** It is deliberately not folded into
 * `PlantingScheme.share`, and that is the important part: those layers are handed to
 * `samplePlanting` by the *generator* as well, to place structural shrubs, so moving them would
 * move real `DesignElement`s in generated concepts. The scheme stays exactly as authored and only
 * the picture gets denser.
 *
 * Saturating is harmless: the sampler places at most one unit per cell, so a share above 1 simply
 * stops rejecting and the layer tops out at `1 / cellSize²`. It still cannot move a plant.
 *
 * **Measured down from 1.25.** `measure:render` counts what the scene actually contains, and it
 * was 8 to 15 plants per square metre of bed against a designed border's 5 to 7 — with 71 to 83%
 * of them under half a metre across. That is not a dense border; it is a carpet of dots, and more
 * of them was making it worse rather than better. Fewer and larger is the same coverage with
 * plants you can tell apart, which is what the reference has. Paired with `CROWN_FILL`.
 */
export const INSTANCE_DENSITY = 0.8;

/**
 * How much bigger a plant is drawn than the spread band it was sampled from.
 *
 * The bands in `SCHEMES` were authored for the *painted* bed, where a unit is a soft blob that
 * bleeds into its neighbours; read as real plants they are nursery sizes rather than mature ones —
 * a mass perennial at 0.4 to 0.7 m is a pot, where the hardy geranium or alchemilla it stands for
 * is 0.6 to 1.0 m across in its third year. The garden this app draws is the mature one.
 *
 * Applied to the **drawn** spread only, after the clamp, and deliberately not to `cellSize`. The
 * sampler's world grid and every plant's identity key on the band, so widening the band itself
 * would move every plant in every saved plan and change what the generator places from the same
 * layers. This moves nothing and only fills the gaps.
 *
 * At 1.45, with the density above, the model is 6 plants per m² at a mean 0.65 m rather than 10 at
 * 0.45 — and because cover goes as `1 − exp(−λ·area)`, the bare ground between them falls even
 * though there are fewer of them.
 */
export const CROWN_FILL = 1.45;

/**
 * A bed's infill plants, placed. `layers` is the bed's planting stack in painting order; an entry
 * that is not a scatter planting layer is `null` and keeps its index, because the index salts the
 * seed. `hasPlanting` says whether the stack has any planting layer at all, scatter or not, which
 * is what decides whether the bed gets an understorey.
 */
export function plantPlacements(
  bed: DesignElement,
  layers: (PlacementLayer | null)[],
  outline: Point[],
  exclusions: Point[][],
  hasPlanting = layers.some((layer) => layer !== null),
): PlacedPlant[] {
  const plants: PlacedPlant[] = [];
  const understorey = hasPlanting ? understoreyLayer(bed) : null;
  const stack: { layer: PlacementLayer | null; key: number | 'understorey' }[] = [
    ...layers.map((layer, index) => ({ layer, key: index })),
    ...(understorey ? [{ layer: understorey, key: 'understorey' as const }] : []),
  ];

  for (const { layer, key } of stack) {
    if (!layer) continue;
    /*
     * The seed is the painter's, exactly: the surface's own seed salted by the layer's index in
     * the stack.
     */
    const seed = key === 'understorey' ? `${bed.id}:understorey` : key === 0 ? bed.id : `${bed.id}#${key}`;

    /*
     * The presentation gain goes in as `share`, never as `spread`: touching `spread` would change
     * `cellSize`, renumber the world grid and slide the entire bed.
     */
    const thinned: PlantingLayer = { ...layer.planting, share: layer.planting.share * INSTANCE_DENSITY };
    const cell = cellSize(layer.planting);
    const taxon = taxonType(layer.planting);

    const minSize = layer.pattern.sizeRange.min / MM_PER_METRE;
    const maxSize = layer.pattern.sizeRange.max / MM_PER_METRE;

    for (const placement of samplePlanting(outline, thinned, seed, { exclusions })) {
      /*
       * The cell this came from, recovered rather than returned. `samplePlanting` jitters within
       * `[col + 0.15, col + 0.85]`, so the floor of `at / cell` is the cell — and that is the
       * plant's identity: a world cell, a bed and a role, none of which depend on how many plants
       * were emitted before it.
       */
      const col = Math.floor(placement.at.x / cell);
      const row = Math.floor(placement.at.y / cell);

      // Clamped into the material's own band, as the painter does.
      const drawn = Math.min(maxSize, Math.max(minSize, placement.spread));
      // Keep the understorey in genuine planting bays. Narrow transition beds retain their low
      // infill, and real structural plants keep their own exclusion space.
      if (key === 'understorey' && distanceToEdge(placement.at, outline) < drawn * 0.45) continue;

      /*
       * Height from where this plant's spread fell in its band, mapped onto the height band. A
       * plant drawn at the top of its spread range is the tall one, which is both physically
       * coherent and free — it costs no extra draw, so it cannot disturb the sequence.
       */
      const t = maxSize > minSize ? (drawn - minSize) / (maxSize - minSize) : 0.5;
      const band = layer.planting.heightBand;

      plants.push({
        id: `${bed.id}:${layer.planting.role}:${col},${row}`,
        at: placement.at,
        spread: drawn * CROWN_FILL,
        height: band.min + (band.max - band.min) * t,
        rotation: placement.rotation,
        tone: placement.tone,
        draws: {
          variant: placement.variant,
          flower: placement.flower,
          family: plantingClusterAt(seed, placement.at).family,
        },
        layer: key,
        role: layer.planting.role,
        taxonType: taxon,
        seed,
        hostId: bed.id,
      });
    }
  }

  return plants;
}

/**
 * The shrubs, as picture rather than as elements. Never fed back to the sampler or the schedule.
 *
 * Every bed needs a back-of-border storey and almost none of them has one. `STRUCTURAL_ROLES`
 * takes `backdrop` and `specimen` out of the drawn stack because the *generator* emits those as
 * real `DesignElement`s — which is right, they are decisions somebody can move — but it emits at
 * most thirty of them across a whole plan, and two of the six schemes (`naturalistic`, the default,
 * and `pollinator`) declare neither role at all. So what was left to draw was the herbaceous
 * layers: a bed of things all the same size, which is the single clearest difference between our
 * borders and a designed one.
 *
 * Sized as a shrub actually is — a metre to nearly two across, standing a metre or more — rather
 * than as the largest perennial. Real structural plants keep their own space through the ordinary
 * exclusion path, so this fills between them instead of doubling them.
 */
export function understoreyLayer(bed: DesignElement): PlacementLayer | null {
  if (bed.material === 'ground-cover') return null;
  /* A mix names its own shrubs, or chose not to have any: a backdrop nobody asked for would be a guess. */
  if (bedMix(bed)) return null;
  const planting: PlantingLayer = {
    role: 'backdrop', taxon: { type: 'shrub' }, heightBand: { min: 0.9, max: 1.9 },
    /*
     * `share` is high because this is a *layer of shrubs*, not an accent: at this spread the cell
     * is 0.84 m, so 0.8 of the cells accepted and thinned by `INSTANCE_DENSITY` is about one shrub
     * per square metre — which is what a mixed border holds. The old 0.28 gave 0.8 per m² of a
     * much smaller plant, and it was the only large thing in the picture.
     */
    spread: { min: 1, max: 1.8 }, share: 0.8, clustering: 0.8, edgeAffinity: -0.55,
  };
  return {
    planting,
    pattern: { patternType: 'scatter', density: 1 / cellSize(planting) ** 2,
      sizeRange: { min: 1000, max: 1800 }, lobes: 9, form: 'blob' },
  };
}

/** A jittered world-space Voronoi field creates rounded drifts instead of square species cells. */
export function plantingClusterAt(seed: string, at: Point): { id: string; centre: Point; family: number } {
  const size = 2.4;
  const col = Math.floor(at.x / size), row = Math.floor(at.y / size);
  let winner = { id: '', centre: at, family: 0 }, nearest = Infinity;
  for (let y = row - 1; y <= row + 1; y++) for (let x = col - 1; x <= col + 1; x++) {
    const random = moduleRandom(`${seed}:drift`, x, y);
    const centre = { x: (x + 0.2 + random() * 0.6) * size, y: (y + 0.2 + random() * 0.6) * size };
    const distance = (at.x - centre.x) ** 2 + (at.y - centre.y) ** 2;
    if (distance < nearest) {
      nearest = distance;
      winner = { id: `${x},${y}`, centre, family: random() };
    }
  }
  return winner;
}

function taxonType(layer: PlantingLayer): string {
  const { type } = layer.taxon;
  return Array.isArray(type) ? (type[0] ?? '') : (type as string);
}

/* ------------------------------------------------------------------ which layers a bed has */

/** A planting layer as the bed resolves it, with the species it stands for when it came from a mix. */
export interface BedLayer extends PlacementLayer {
  species: PlantSpecies | null;
}

/**
 * The planting a bed carries, above its ground: a mix names species, a layered material follows its
 * planting scheme. `base` is the scheme's soil material, which is what a renderer lays under it.
 */
export interface BedPlantingLayers {
  source: 'mix' | 'scheme';
  base: string | null;
  layers: BedLayer[];
}

/**
 * The materials that are drawn as a planting scheme's layers rather than as one texture. Every
 * other planting material is a single surface, and every mix is its own species.
 */
const LAYERED_MATERIALS = new Set(['mixed-border', 'shrubs', 'ornamental-grasses', 'ground-cover']);

const PLANTING_MATERIALS = new Set<string>(MATERIALS['planting-bed'].map((material) => material.id));

/**
 * The planting layers a bed of this material carries, or `null` for a bed drawn as one texture —
 * the geometric half of the web's `resolveLayers`, which adds sprites, flowers and soil to it.
 *
 * Structural roles are left out: a backdrop shrub or a specimen is a `DesignElement` the generator
 * placed, not infill, and drawing both would plant it twice.
 */
export function bedPlanting(
  material: string,
  element?: { plantingStyle?: string | undefined; planting?: DesignElement['planting'] },
): BedPlantingLayers | null {
  if (!PLANTING_MATERIALS.has(material)) return null;
  const mix = bedMix({ planting: element?.planting, material });
  if (mix) return { source: 'mix', base: null, layers: mixLayers(mix) };
  if (!LAYERED_MATERIALS.has(material)) return null;
  return schemeLayers(schemeFor(element?.plantingStyle, material));
}

/**
 * A bed's stack as `plantPlacements` takes it: the ground first, which plants nothing, then each
 * planting layer. The ground keeps index 0 because the index salts every layer's seed.
 */
export function bedPlacementLayers(
  material: string,
  element?: { plantingStyle?: string | undefined; planting?: DesignElement['planting'] },
): { layers: (BedLayer | null)[]; hasPlanting: boolean } {
  const planting = bedPlanting(material, element);
  if (!planting) return { layers: [null], hasPlanting: false };
  return { layers: [null, ...planting.layers], hasPlanting: planting.layers.length > 0 };
}

function schemeLayers(scheme: PlantingScheme): BedPlantingLayers {
  const layers = scheme.layers
    .filter((layer) => !isStructuralRole(layer.role))
    .map((layer): BedLayer => ({
      planting: layer,
      pattern: scatterFor(layer, layer.taxon.type === 'grass-ornamental' ? 'tufted' : 'blob'),
      species: null,
    }));
  return { source: 'scheme', base: scheme.base, layers };
}

/** How much denser a mix is drawn than its shares, so a mix bed reads as full as a scheme's. */
const MIX_DENSITY = 1.2;

/** Tallest first, so the shrubs are drawn behind the ground cover. */
const FORM_ORDER: PlantSpecies['form'][] = ['shrub', 'grass', 'perennial', 'groundcover'];

function mixLayers(mix: Parameters<typeof normalisedMix>[0]): BedLayer[] {
  return normalisedMix(mix)
    .map((entry) => ({ entry, species: speciesById(entry.speciesId)! }))
    .sort((a, b) => FORM_ORDER.indexOf(a.species.form) - FORM_ORDER.indexOf(b.species.form))
    .map(({ entry, species }): BedLayer => {
      const planting = speciesLayer(species, entry.share);
      return {
        planting,
        pattern: scatterFor(planting, species.form === 'grass' ? 'tufted' : 'blob'),
        species,
      };
    });
}

/**
 * The scatter a layer is drawn with: one unit per cell, sized within the layer's own spread.
 *
 * The density is the sampler's own cell, so the painter and the placement agree about how many
 * plants a bed holds.
 */
function scatterFor(layer: PlantingLayer, form: 'tufted' | 'blob'): ScatterPattern {
  const spacing = cellSize(layer);
  return {
    patternType: 'scatter',
    density: 1 / (spacing * spacing),
    sizeRange: { min: layer.spread.min * MM_PER_METRE, max: layer.spread.max * MM_PER_METRE },
    lobes: layer.role === 'edge' ? 7 : 9,
    form,
  };
}

/** One species of a mix as a planting layer: its mature size, its place in the bed, its share. */
export function speciesLayer(species: PlantSpecies, share: number): PlantingLayer {
  const byForm = {
    shrub: { role: 'mid', type: 'shrub', edgeAffinity: -0.6 },
    grass: { role: 'mid', type: 'grass-ornamental', edgeAffinity: 0 },
    perennial: { role: 'mass', type: 'perennial', edgeAffinity: -0.1 },
    groundcover: { role: 'edge', type: 'ground-cover', edgeAffinity: 0.6 },
    tree: { role: 'mid', type: 'shrub', edgeAffinity: -0.6 },
    hedge: { role: 'mid', type: 'shrub', edgeAffinity: -0.6 },
  } as const;
  const form = byForm[species.form];
  return {
    role: form.role,
    taxon: { type: form.type },
    heightBand: { min: species.matureHeight * 0.75, max: species.matureHeight },
    spread: { min: species.matureSpread * 0.7, max: species.matureSpread },
    share: Math.min(1, share * MIX_DENSITY),
    clustering: 0.7,
    edgeAffinity: form.edgeAffinity,
  };
}

/* ------------------------------------------------------------------ what a bed plants round */

/**
 * The footprints a bed's planting leaves a gap for: the features standing in it and every placed
 * plant, so a structure in a bed leaves the same gap in 3D that it leaves in the plan. Only nearby
 * footprints are returned, which also keeps distant edits out of a bed's raster cache key.
 */
export function plantingExclusions(bed: DesignElement, elements: DesignElement[]): Point[][] {
  if (bed.category !== 'planting-bed' || bed.shape.kind === 'point' || bed.material === 'hedging')
    return [];
  const box = boundingBox(elementOutline(bed));
  return elements
    .filter(
      (element) =>
        element.id !== bed.id &&
        !element.hidden &&
        (element.role === 'feature' || element.shape.kind === 'point') &&
        !(element.category === 'planting-bed' && element.shape.kind !== 'point'),
    )
    .map(elementOutline)
    .filter((outline) => {
      const other = boundingBox(outline);
      return (
        other.minX < box.minX + box.width &&
        other.minX + other.width > box.minX &&
        other.minY < box.minY + box.length &&
        other.minY + other.length > box.minY
      );
    });
}
