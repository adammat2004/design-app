import {
  plantPlacements,
  scatterForm,
  understoreyLayer,
  type DesignElement,
  type PlacementLayer,
  type Point,
} from '@garden-studio/schema';
import type { AssetId } from '../materials/assets/asset-spec';
import { catalogueVariants } from '../materials/assets/catalogue';
import { assetsMatching, type TaxonQuery } from '../materials/assets/taxonomy';
import type { SurfaceLayer } from '../materials/layers';
import type { RenderPlant } from './scene';
import { layerForPlantingRole } from './visual-layer';

/**
 * How big a flower head is against the plant carrying it — the painter's own number.
 *
 * Flowers sit *on* foliage rather than beside it, so the sprite is drawn concentric and small. Much
 * larger and the plant disappears under its own bloom, which is a garden-centre photograph rather
 * than a border.
 */
const FLOWER_SCALE = 0.55;

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
): RenderPlant[] {
  /*
   * Where the plants stand is geometry and is decided in the schema, with no picture in it
   * (`plantPlacements`), so the AR builder and the 3D editor place the very same plants. What each
   * one looks like is decided here, from draws the sampler already made — which is why this split
   * cannot move a plant.
   */
  const placements: (PlacementLayer | null)[] = layers.map((layer) =>
    layer.planting && layer.entry.pattern.patternType === 'scatter'
      ? { planting: layer.planting, pattern: layer.entry.pattern }
      : null,
  );
  const reference = layers.find((layer) => layer.planting);
  const looks = new Map<number | 'understorey', Look>();
  const lookOf = (key: number | 'understorey'): Look => {
    let look = looks.get(key);
    if (!look) {
      look = key === 'understorey' ? understoreyLook(bed, reference!) : layerLook(layers[key]!);
      looks.set(key, look);
    }
    return look;
  };

  return plantPlacements(bed, placements, outline, exclusions, reference !== undefined).map((plant) => {
    const look = lookOf(plant.layer);
    /* A species layer draws its own picture; anything else chooses from its query as before. */
    const asset = look.pin
      ? { assetId: look.pin.family, variant: look.pin.variant }
      : look.query
        ? chooseAsset(look.query, plant.draws.variant, plant.draws.family)
        : null;
    return {
      id: plant.id,
      at: plant.at,
      spread: plant.spread,
      height: plant.height,
      // A plan sprite is lit flat and turns freely, which is where most of a bed's variety comes from.
      rotation: plant.rotation,
      assetId: asset?.assetId ?? null,
      variant: asset?.variant ?? 0,
      /*
       * In bloom or not, decided by a draw the sampler **already made**. `draws.flower` is a unit
       * interval drawn in the same sequence as the tone and the variant, so reading it here costs
       * no draw and cannot shift a single plant — which is what lets flowers arrive without
       * renumbering a garden. The share is the material's own accent rate.
       */
      flower:
        look.flowers && plant.draws.flower < look.flowers.share
          ? { assetId: look.flowers.sprite, scale: FLOWER_SCALE }
          : null,
      tone: plant.tone,
      visualLayer: layerForPlantingRole(plant.role, plant.taxonType),
      hostId: plant.hostId,
      blob: { seed: plant.seed, lobes: look.lobes, form: look.form, palette: look.palette },
    };
  });
}

/** What one layer's plants are drawn with: resolved once per layer rather than once per plant. */
interface Look {
  query: TaxonQuery | undefined;
  flowers: NonNullable<SurfaceLayer['assets']>['flowers'] | null;
  pin: NonNullable<SurfaceLayer['assets']>['pin'] | undefined;
  lobes: number;
  form: RenderPlant['blob']['form'];
  palette: string[];
}

function layerLook(layer: SurfaceLayer): Look {
  const pattern = layer.entry.pattern;
  if (pattern.patternType !== 'scatter') throw new Error('a planted layer is always a scatter');
  return {
    query: layer.assets?.sprites,
    flowers: layer.assets?.flowers ?? null,
    pin: layer.assets?.pin,
    lobes: pattern.lobes,
    form: scatterForm(pattern),
    palette: layer.entry.palette,
  };
}

/** The understorey's shrubs take the bed's own palette and any shrub sprite. */
function understoreyLook(bed: DesignElement, reference: SurfaceLayer): Look {
  const pattern = understoreyLayer(bed)!.pattern;
  return {
    query: { group: 'vegetation', type: 'shrub' },
    flowers: null,
    pin: undefined,
    lobes: pattern.lobes,
    form: scatterForm(pattern),
    palette: reference.entry.palette,
  };
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
  familyChoice: number,
): { assetId: AssetId; variant: number } | null {
  // Species repeat in short drifts, while individuals retain their own crown variant.
  const families = assetsMatching(query).filter((id) => catalogueVariants(id).length > 0);
  if (!families.length) return null;
  const assetId = families[Math.min(families.length - 1, Math.floor(familyChoice * families.length))]!;
  const variants = catalogueVariants(assetId);
  if (!variants.length) return null;
  const entry = variants[Math.min(variants.length - 1, Math.floor(unitInterval * variants.length))]!;
  return { assetId, variant: entry.variant };
}
