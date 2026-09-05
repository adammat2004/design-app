import {
  MM_PER_METRE,
  schemeFor,
  type DesignElement,
  type PlantingLayer,
  type PlantingScheme,
} from '@garden-studio/schema';
import type { AssetId } from './assets/asset-spec';
import { materialAssets, type MaterialAssetSpec } from './assets/material-assets';
import type { MaterialManifestEntry } from './palette';
import { cellSize } from './planting/sample';

/**
 * What a surface is made of, in the order it is painted.
 *
 * Until now a surface was **one** pattern: `drawSurfacePattern` resolved a single
 * `MaterialManifestEntry` and `paint()` switched on its `patternType` exactly once. That is the
 * hard ceiling on nearly everything the plan needs to look like a designed garden, because the
 * things that read as designed are all stacks:
 *
 * ```
 *   a planting bed   =  soil / mulch  +  mass planting  +  mid layer  +  edging  +  specimens
 *   a lawn           =  turf          +  mow stripes    +  wear at the thresholds
 *   a gravel garden  =  aggregate     +  the plants standing in it
 *   a patio          =  slabs         +  an edging course
 * ```
 *
 * A layer **is** a `MaterialManifestEntry`, deliberately, rather than a new record the painters
 * would have to learn. Every painter already takes a manifest entry and reads its pattern, palette
 * and joint colour off it; making a layer the same shape means the whole stack works through the
 * existing signatures and a one-layer stack is bit-for-bit the call that was made before.
 *
 * ## The rules a layer resolver has to obey
 *
 * - **Pure.** A function of the material alone (and later the element), so the raster cache key
 *   does not grow: `material.id` already names the whole stack.
 * - **Anchored to the same origin.** Every layer paints through `gridRange()` from the surface's
 *   own pattern origin, which is what keeps two abutting patios in one course. A layer that
 *   anchored to its own bounding box would put a seam down every shared edge.
 * - **Layer 0 is the ground.** It is the only layer allowed to be opaque across the whole surface;
 *   everything after it draws *into* what is already there.
 *
 * ## Why this returns one entry today
 *
 * It is deliberately a no-op refactor. The gate on landing it is the byte-identical-without-assets
 * test, and a resolver that returned two layers on day one would make that test's failure
 * ambiguous — a change in the plumbing and a change in the picture at the same time, with no way
 * to tell which caused what. The stacks arrive material by material, each with its own sheet to
 * judge it by.
 */
export interface SurfaceLayer {
  /** What the painters take: a pattern, a palette and a joint colour. */
  entry: MaterialManifestEntry;
  /**
   * Which assets this layer draws with, overriding the material's own.
   *
   * A planting layer needs it: the bed's material says "soil and a mixture of plants", but the
   * *backdrop* layer wants shrubs and the *edge* layer wants ground cover, and both are drawn on
   * one element. Absent means the material's own assets, which is every non-planting surface.
   */
  assets?: MaterialAssetSpec;
  /**
   * The scheme layer this came from, when it came from one.
   *
   * Present makes the painter place its units with `samplePlanting` instead of walking its own
   * even grid — which is the whole of the planting engine: drifts, edge grading and a share that
   * thins a layer rather than simply spacing it further apart. Absent is every other surface, and
   * takes the grid it always had.
   */
  planting?: PlantingLayer;
}

/**
 * A surface's stack.
 *
 * A planting bed becomes a soil ground plus one scatter per scheme layer; everything else is the
 * one entry it always was. The scheme is resolved from `element.plantingStyle`, which is a plain
 * string on the document, so an unknown style falls back rather than refusing to draw.
 */
/**
 * Which planting materials are drawn as a layered bed.
 *
 * `hedging` is the one that is not, and the omission is the point: a hedge is a single clipped body
 * with a defined edge, not a border. Sending it through the stack would plant it with backdrop
 * shrubs and edging, which is a description of a completely different thing. It keeps the
 * `clipped-mass` painter it already had, and Phase F's hedge run is what actually improves it.
 */
const LAYERED_MATERIALS = new Set(['mixed-border', 'shrubs', 'ornamental-grasses', 'ground-cover']);

export function resolveLayers(
  material: MaterialManifestEntry,
  element?: Pick<DesignElement, 'plantingStyle' | 'category'>,
): SurfaceLayer[] {
  if (material.category !== 'planting-bed' || !LAYERED_MATERIALS.has(material.id)) {
    return [{ entry: material }];
  }

  return plantingLayers(material, schemeFor(element?.plantingStyle, material.id));
}

/**
 * A planting bed as a ground and a stack of scatters.
 *
 * ## How a scheme layer becomes something the painters already understand
 *
 * Each layer is a `scatter` pattern whose numbers come from the layer rather than from the
 * material: density from the spacing `cellSize` derives from its spread, size range from the
 * spread itself, and the sprite family from its taxon query. So no painter learns anything new —
 * `paintScatter` draws a backdrop shrub layer exactly the way it drew a bed of shrubs, because
 * from its side that is what it is.
 *
 * ## Why the ground layer works out
 *
 * Layer 0 carries the soil texture and **no** sprite query, which makes `resolveAssets` report
 * `textureIsMass` — so it tiles the soil, tints it to the palette, and returns without drawing
 * units. That is exactly a bed's ground. Every later layer carries sprites and no texture, so it
 * skips the ground branch and draws only plants. Neither case needed a special path.
 */
function plantingLayers(
  material: MaterialManifestEntry,
  scheme: PlantingScheme,
): SurfaceLayer[] {
  const ground: SurfaceLayer = {
    entry: {
      ...material,
      /*
       * A scatter with the smallest legal density, because the ground never draws units — the
       * mass-texture branch returns first. It has to be *some* pattern, and reusing the material's
       * own would have the ground try to draw the bed's plants underneath the layers that draw
       * them properly.
       */
      pattern: { patternType: 'scatter', density: 1, sizeRange: { min: 20, max: 40 }, lobes: 5 },
      palette: [material.jointColour],
    },
    assets: { texture: soilTextureFor(scheme.base) },
  };

  const layers = scheme.layers.map((layer): SurfaceLayer => {
    const spacing = cellSize(layer);

    return {
      entry: {
        ...material,
        pattern: {
          patternType: 'scatter',
          /*
           * Units per square metre from the layer's own spacing, scaled by its share — which is
           * the same number the sampler accepts on, so the drawn density and the sampled density
           * cannot drift apart.
           */
          /*
           * The layer's *natural* density, with no share term. `share` thins the layer in
           * `samplePlanting`, by refusing cells — which is what lets it drift. Multiplying it in
           * here as well thinned it twice, once by rejection and once by spacing the grid further
           * apart, and a cottage border came out as scattered plants on a field of bark.
           */
          density: 1 / (spacing * spacing),
          sizeRange: {
            min: layer.spread.min * MM_PER_METRE,
            max: layer.spread.max * MM_PER_METRE,
          },
          lobes: layer.role === 'edge' ? 7 : 9,
          form: layer.taxon.type === 'grass-ornamental' ? 'tufted' : 'blob',
        },
      },
      assets: {
        sprites: {
          group: 'vegetation',
          type: layer.taxon.type,
          ...(layer.taxon.tags ? { tags: layer.taxon.tags } : {}),
        },
      },
      planting: layer,
    };
  });

  return [ground, ...layers];
}

/**
 * The texture a scheme's base draws as.
 *
 * A scheme names a `MaterialId` for its ground — bark for a border, gravel for a dry garden — and
 * this resolves it to the family that material already uses, rather than a second table of soils.
 */
function soilTextureFor(base: string): AssetId | undefined {
  return materialAssets(base)?.texture;
}

/**
 * The seed for one layer of a stack.
 *
 * Layer 0 keeps the surface's bare seed, so a one-layer stack draws exactly what a seeded surface
 * drew before there were layers. Later layers are salted, or two layers sharing a pattern would
 * place their units in identical positions and the upper one would simply hide the lower.
 *
 * Salted by index rather than by anything about the layer's content, because the index is the one
 * thing that is stable under editing a palette or swapping a sprite family — keying on the
 * material id would reshuffle a bed the moment somebody tuned a hex.
 */
export function layerSeed(seed: string, index: number): string {
  return index === 0 ? seed : `${seed}#${index}`;
}
