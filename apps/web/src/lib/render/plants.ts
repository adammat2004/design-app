import {
  cellSize,
  MM_PER_METRE,
  samplePlanting,
  scatterForm,
  type DesignElement,
  type PlantingLayer,
  type Point,
} from '@garden-studio/schema';
import type { AssetId } from '../materials/assets/asset-spec';
import { catalogueVariants } from '../materials/assets/catalogue';
import { assetsMatching, type TaxonQuery } from '../materials/assets/taxonomy';
import type { SurfaceLayer } from '../materials/layers';
import { MATURITY } from './maturity';
import type { Maturity, RenderPlant } from './scene';
import { layerForPlantingRole } from './visual-layer';

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
 */
const INSTANCE_DENSITY = 1.25;

/**
 * A bed's infill, as things rather than as texture.
 *
 * ## Why this is the change that matters
 *
 * Until now a bed's plants were painted *into its own raster*, inside `clip(outline)`. Four things
 * follow from that clip, and together they are most of the reason a generated plan reads as a
 * diagram rather than as a garden:
 *
 * - no plant can cross the edge of its bed, so every bed is a cut-out with a hard boundary;
 * - no foliage can spill onto the lawn or the paving beside it, so nothing ever reads as one mass;
 * - a plant cannot sit in a height order with anything outside its own surface;
 * - and a plant cannot shadow anything but its own bed.
 *
 * Lifting the placements out of the raster answers all four at once, and costs nothing in
 * fidelity: this is the *same* `samplePlanting` call the painter made, seeded the same way, so a
 * bed's plants land exactly where they always did. They are simply drawn as sprites above the
 * ground instead of inside it.
 *
 * ## Render-only, deliberately
 *
 * These are not `DesignElement`s and must never become them. The design's structural plants — a
 * specimen tree, a backdrop shrub — *are* elements, because they are decisions somebody made and
 * can move; `STRUCTURAL_ROLES` is where that line is drawn, and `plantingLayers` already filters
 * them out of the painted stack so they are not drawn twice. Everything left is infill: it has no
 * identity worth persisting, there are hundreds of it, and it must not turn a drawn density into
 * a shopping list.
 */
export function buildPlants(
  bed: DesignElement,
  layers: SurfaceLayer[],
  outline: Point[],
  exclusions: Point[][],
  maturity: Maturity,
): RenderPlant[] {
  const factors = MATURITY[maturity];
  const plants: RenderPlant[] = [];

  layers.forEach((layer, index) => {
    if (!layer.planting) return;

    const query = layer.assets?.sprites;
    const pattern = layer.entry.pattern;
    if (pattern.patternType !== 'scatter') return;

    /*
     * The seed is the painter's, exactly: the surface's own seed salted by the layer's index in
     * the stack. `layerSeed` is not called here only because it is the same two-line rule and
     * importing the painter's module for it would tie the scene to the backend.
     */
    const seed = index === 0 ? bed.id : `${bed.id}#${index}`;

    /*
     * Density is the *only* thing maturity is allowed to change about the sampling, and it goes
     * in as `share`. See `maturity.ts`: touching `spread` here would change `cellSize`, renumber
     * the world grid and slide the entire bed as the slider moved.
     */
    const thinned: PlantingLayer = {
      ...layer.planting,
      share: layer.planting.share * factors.density * INSTANCE_DENSITY,
    };
    const cell = cellSize(layer.planting);
    const visualLayer = layerForPlantingRole(layer.planting.role, taxonType(layer.planting));

    const minSize = pattern.sizeRange.min / MM_PER_METRE;
    const maxSize = pattern.sizeRange.max / MM_PER_METRE;
    const form = scatterForm(pattern);

    for (const placement of samplePlanting(outline, thinned, seed, { exclusions })) {
      /*
       * The cell this came from, recovered rather than returned. `samplePlanting` jitters within
       * `[col + 0.15, col + 0.85]`, so the floor of `at / cell` is the cell — and that is the
       * plant's identity: a world cell, a bed and a role, none of which depend on how many plants
       * were emitted before it.
       */
      const col = Math.floor(placement.at.x / cell);
      const row = Math.floor(placement.at.y / cell);

      // Clamped into the material's own band before maturity scales it, as the painter does.
      const drawn = Math.min(maxSize, Math.max(minSize, placement.spread));
      const spread = drawn * factors.crown;

      /*
       * Height from where this plant's spread fell in its band, mapped onto the height band. A
       * plant drawn at the top of its spread range is the tall one, which is both physically
       * coherent and free — it costs no extra draw, so it cannot disturb the sequence.
       */
      const t = maxSize > minSize ? (drawn - minSize) / (maxSize - minSize) : 0.5;
      const band = layer.planting.heightBand;
      const height = (band.min + (band.max - band.min) * t) * factors.crown;

      const asset = query ? chooseAsset(query, placement.variant) : null;

      plants.push({
        id: `${bed.id}:${layer.planting.role}:${col},${row}`,
        at: placement.at,
        spread,
        height,
        rotation: placement.rotation,
        assetId: asset?.assetId ?? null,
        variant: asset?.variant ?? 0,
        flower: null,
        tone: placement.tone,
        visualLayer,
        hostId: bed.id,
        blob: { seed, lobes: pattern.lobes, form, palette: layer.entry.palette },
      });
    }
  });

  return plants;
}

/**
 * Which asset, and which variant of it, a placement draws as.
 *
 * Resolved against the **catalogue** rather than against what has loaded, and the difference
 * matters: the painter picks from the flattened list of loaded images, so a plant could change
 * species as the second preload wave arrived. Choosing from the manifest gives every plant a
 * fixed identity from the first frame; a file that is missing or still in flight simply falls
 * back to the drawn blob, exactly as it always did.
 *
 * `assetsMatching` returns families in **manifest order and never sorted**, which is what makes
 * this stable — the order is part of what a bed looks like.
 */
function chooseAsset(
  query: TaxonQuery,
  unitInterval: number,
): { assetId: AssetId; variant: number } | null {
  const choices: { assetId: AssetId; variant: number }[] = [];

  for (const assetId of assetsMatching(query)) {
    for (const entry of catalogueVariants(assetId)) {
      choices.push({ assetId, variant: entry.variant });
    }
  }

  if (choices.length === 0) return null;
  const index = Math.min(choices.length - 1, Math.floor(unitInterval * choices.length));
  return choices[index]!;
}

function taxonType(layer: PlantingLayer): string {
  const { type } = layer.taxon;
  return Array.isArray(type) ? (type[0] ?? '') : (type as string);
}
