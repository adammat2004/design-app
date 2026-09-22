import {
  cellSize,
  distanceToEdge,
  MM_PER_METRE,
  samplePlanting,
  scatterForm,
  type DesignElement,
  type PlantingLayer,
  type Point,
} from '@garden-studio/schema';
import type { AssetCamera, AssetId } from '../materials/assets/asset-spec';
import { catalogueVariants } from '../materials/assets/catalogue';
import { elevatedTwin } from '../materials/assets/material-assets';
import { assetsMatching, type TaxonQuery } from '../materials/assets/taxonomy';
import type { SurfaceLayer } from '../materials/layers';
import { foldRotation } from '../materials/symbols/elevated';
import { MATURITY } from './maturity';
import type { Maturity, RenderPlant } from './scene';
import { layerForPlantingRole } from './visual-layer';
import { plantingClusterAt } from './plant-clusters';

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
const INSTANCE_DENSITY = 0.8;

/**
 * How much bigger a plant is drawn than the spread band it was sampled from.
 *
 * The bands in `SCHEMES` were authored for the *painted* bed, where a unit is a soft blob that
 * bleeds into its neighbours; read as real plants they are nursery sizes rather than mature ones —
 * a mass perennial at 0.4 to 0.7 m is a pot, where the hardy geranium or alchemilla it stands for
 * is 0.6 to 1.0 m across in its third year. The garden this app draws is the mature one: that is
 * what `maturity` means and what the whole planting model claims.
 *
 * Applied to the **drawn** spread only, after the clamp, and deliberately not to `cellSize`. The
 * sampler's world grid, every plant's identity and the `year-1 ⊆ year-3 ⊆ mature` nesting all key
 * on the band, so widening the band itself would move every plant in every saved plan and change
 * what the generator places from the same layers. This moves nothing and only fills the gaps.
 *
 * At 1.45, with the density above, the model is 6 plants per m² at a mean 0.65 m rather than 10 at
 * 0.45 — and because cover goes as `1 − exp(−λ·area)`, the bare ground between them falls even
 * though there are fewer of them.
 */
const CROWN_FILL = 1.45;

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
  maturity: Maturity,
  /**
   * Which library to draw from. **Never inferred**: resolving a family and then translating it to
   * its elevated twin is how `vis-*` art reached the 2D Plan once already, and nothing below this
   * line can tell which view it is being built for.
   */
  camera: AssetCamera = 'elevated',
): RenderPlant[] {
  const factors = MATURITY[maturity];
  const plants: RenderPlant[] = [];

  const understorey = understoreyLayer(bed, layers);
  const visualLayers = understorey ? [...layers, understorey] : layers;
  visualLayers.forEach((layer, index) => {
    if (!layer.planting) return;

    const query = layer.assets?.sprites;
    const flowers = layer.assets?.flowers ?? null;
    const pattern = layer.entry.pattern;
    if (pattern.patternType !== 'scatter') return;

    /*
     * The seed is the painter's, exactly: the surface's own seed salted by the layer's index in
     * the stack. `layerSeed` is not called here only because it is the same two-line rule and
     * importing the painter's module for it would tie the scene to the backend.
     */
    const seed = layer === understorey ? `${bed.id}:understorey` : index === 0 ? bed.id : `${bed.id}#${index}`;

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
      // Keep this middle-height layer in genuine planting bays. Narrow transition beds retain
      // their low infill, and real structural plants keep their own exclusion space.
      if (layer === understorey && distanceToEdge(placement.at, outline) < drawn * 0.45) continue;
      const spread = drawn * factors.crown * CROWN_FILL;

      /*
       * Height from where this plant's spread fell in its band, mapped onto the height band. A
       * plant drawn at the top of its spread range is the tall one, which is both physically
       * coherent and free — it costs no extra draw, so it cannot disturb the sequence.
       */
      const t = maxSize > minSize ? (drawn - minSize) / (maxSize - minSize) : 0.5;
      const band = layer.planting.heightBand;
      const height = (band.min + (band.max - band.min) * t) * factors.crown;

      const familyChoice = plantingClusterAt(seed, placement.at).family;
      const asset = query ? chooseAsset(query, placement.variant, familyChoice, camera) : null;

      plants.push({
        id: `${bed.id}:${layer.planting.role}:${col},${row}`,
        at: placement.at,
        spread,
        height,
        /*
         * An elevated sprite carries its own light, so a full turn turns the sun with it and the
         * bed ends up lit from every direction at once. A plan sprite is lit flat and turns freely,
         * which is where most of a bed's variety comes from — so the limit applies to one and not
         * the other, and `foldRotation` narrows the distribution rather than clamping it onto two
         * values. Costs no draw, so the sampler's sequence is untouched either way.
         */
        rotation: asset?.elevated ? foldRotation(placement.rotation) : placement.rotation,
        assetId: asset?.assetId ?? null,
        variant: asset?.variant ?? 0,
        /*
         * In bloom or not, decided by a draw the sampler **already made**. `PlantPlacement.flower`
         * is a unit interval drawn in the same sequence as the tone and the variant, so reading it
         * here costs no draw and cannot shift a single plant — which is what lets flowers arrive
         * without renumbering a garden. The share is the material's own accent rate.
         *
         * Hard-coded `null` until now, so a mixed border had no flowers in either view: the field
         * existed, the asset existed, the share existed, and nothing joined them up.
         */
        flower:
          flowers && placement.flower < flowers.share
            ? { assetId: flowers.sprite, scale: FLOWER_SCALE }
            : null,
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
  familyChoice: number,
  camera: AssetCamera,
): { assetId: AssetId; variant: number; elevated: boolean } | null {
  // Species repeat in short drifts, while individuals retain their own crown variant.
  const families = assetsMatching(query).filter((id) => catalogueVariants(id).length > 0);
  if (!families.length) return null;
  const planId = families[Math.min(families.length - 1, Math.floor(familyChoice * families.length))]!;

  /*
   * The plan family is chosen first and *then* translated, which is the whole design of
   * `ELEVATED_TWINS` — see the note there. Asking the elevated library directly would answer a
   * different-length list, so the seeded index would land on a different species and the same
   * garden would be planted differently in the two views.
   *
   * The variant is re-drawn from the same `unitInterval` against the twin's own count, so a family
   * with three elevated variants still spreads its plants across all three rather than collapsing
   * onto whichever one happened to share a number with the plan sprite.
   */
  const twin = camera === 'elevated' ? elevatedTwin(planId) : null;
  const assetId = twin ?? planId;
  const variants = catalogueVariants(assetId);
  if (!variants.length) return null;
  const entry = variants[Math.min(variants.length - 1, Math.floor(unitInterval * variants.length))]!;
  return { assetId, variant: entry.variant, elevated: twin !== null };
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
function understoreyLayer(bed: DesignElement, layers: SurfaceLayer[]): SurfaceLayer | null {
  const reference = layers.find((layer) => layer.planting);
  if (!reference || bed.material === 'ground-cover') return null;
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
    entry: { ...reference.entry, pattern: { patternType: 'scatter', density: 1 / cellSize(planting) ** 2,
      sizeRange: { min: 1000, max: 1800 }, lobes: 9, form: 'blob' } },
    assets: { sprites: { group: 'vegetation', type: 'shrub' } }, planting,
  };
}

function taxonType(layer: PlantingLayer): string {
  const { type } = layer.taxon;
  return Array.isArray(type) ? (type[0] ?? '') : (type as string);
}
