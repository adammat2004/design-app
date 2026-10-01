import type { DesignElement } from './concepts.js';
import type { ZoneId } from './zone-id.js';
import { ENCLOSURE_KINDS } from './enclosure.js';
import type { PlacedFeature } from './features.js';
import { speciesById } from './plants/species.js';

/**
 * What a feature the user kept on step 2 becomes on the plan.
 *
 * It used to become a grey `existing-feature` of the shape it was drawn as, and nothing else — so a
 * kept 7 m oak was a disc a metre tall: it cast no real shadow, gave no canopy and screened nothing,
 * and the generator composed a garden round a tree it could not see was a tree. Now what the user
 * said about it is carried with it:
 *
 * - **a tree** keeps its species, its height and its spread, and carries a tree symbol, so it draws
 *   as a canopy, casts from its crown, counts as canopy and is legal on its trunk like any tree;
 * - **a fence** becomes an `enclosure` with `status: 'keep'`, so it draws, casts and replaces the
 *   survey's line where it lies along one, exactly as a proposed fence would;
 * - **anything else** is carried as it always was.
 *
 * The category stays `existing-feature` for a tree, because "this was here already" is what the
 * schedule, the palette and the design events all key on; the symbol is what says it is a tree.
 */

/** A kept tree nobody measured: a garden tree of ordinary size, not a sapling and not a veteran. */
export const KEPT_TREE_HEIGHT = 6;

export function keptElement(feature: PlacedFeature, id: string, zone: ZoneId): DesignElement {
  const base: DesignElement = {
    id,
    category: 'existing-feature',
    role: 'feature',
    name: feature.name,
    shape: feature.geometry,
    zone,
  };

  if (feature.kind === 'tree' && feature.geometry.kind === 'point') {
    const species = speciesById(feature.plantId);
    const radius =
      feature.spread !== undefined ? feature.spread / 2 : species ? species.matureSpread / 2 : feature.geometry.radius;
    return {
      ...base,
      shape: { ...feature.geometry, radius },
      symbol: species?.symbol ?? 'tree-deciduous',
      height: feature.height ?? species?.matureHeight ?? KEPT_TREE_HEIGHT,
      ...(species ? { plantId: species.id } : {}),
      status: 'keep',
    };
  }

  if (feature.kind === 'fence' && feature.geometry.kind === 'polyline') {
    const fence = ENCLOSURE_KINDS.fence;
    return {
      ...base,
      category: 'enclosure',
      shape: { ...feature.geometry, width: fence.thickness },
      material: fence.material,
      enclosure: { kind: 'fence' },
      ...(feature.height !== undefined ? { height: feature.height } : {}),
      status: 'keep',
    };
  }

  return feature.height !== undefined ? { ...base, height: feature.height } : base;
}
