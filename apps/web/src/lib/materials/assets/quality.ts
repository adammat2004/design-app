import { ASSET_FAMILIES, type AssetFamily, type AssetId } from './asset-spec';
import { catalogueVariants } from './catalogue';

export interface AssetRenderQuality {
  groundShadow: 'none' | 'effect' | 'unverified';
  rotation: 'none' | 'quarter-turn' | 'free';
  mirror: boolean;
  minPx: number;
  preferredMaxPxPerMetre: number;
  saturation: number;
}

/**
 * The renderer's transform policy for a family, from what the family says about itself.
 *
 * The defaults are conservative and derived: vegetation is free to turn, everything else stays as
 * photographed. Anything a family knows better — that a gravel is isotropic and may be
 * quarter-turned and mirrored, that a bark is over-saturated at source — it states on its own
 * `render` field, which is spread last. There used to be a set of eight texture ids and one
 * saturation literal in here; a policy about a family belongs on the family.
 */
export function assetQuality(id: AssetId): AssetRenderQuality {
  const family: AssetFamily = ASSET_FAMILIES[id];
  return {
    groundShadow: family.taxon.group === 'effect' ? 'effect' : 'unverified',
    rotation: family.taxon.group === 'vegetation' ? 'free' : 'none',
    mirror: false,
    minPx: family.kind === 'sprite' ? 2 : 4,
    preferredMaxPxPerMetre: Math.min(200, family.sizePx.w / family.metres.w),
    saturation: 1,
    ...family.render,
  };
}

export function assetQualityAudit(id: AssetId) {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const variants = catalogueVariants(id);
  return {
    id,
    footprint: family.metres,
    quality: assetQuality(id),
    pixelsPerMetre: variants.map((entry) => ({
      variant: entry.variant,
      x: entry.widthPx / family.metres.w,
      y: entry.heightPx / family.metres.h,
    })),
  };
}
