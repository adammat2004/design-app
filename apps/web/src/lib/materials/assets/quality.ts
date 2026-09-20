import { ASSET_FAMILIES, elevatedFrame, type AssetFamily, type AssetId } from './asset-spec';
import { catalogueVariants } from './catalogue';
import { elevatedTwin } from './material-assets';
import { assetAnchor } from './taxonomy';

export interface AssetRenderQuality {
  lighting: 'neutral' | 'upper-left';
  cameraCompliance: 'declared' | 'reviewed' | 'noncompliant';
  groundShadow: 'none' | 'effect' | 'unverified';
  rotation: 'none' | 'quarter-turn' | 'limited' | 'free';
  mirror: boolean;
  minPx: number;
  preferredMaxPxPerMetre: number;
  replacement: 'ready' | 'review' | 'needed';
  saturation: number;
}

/**
 * The renderer's transform policy for a family, from what the family says about itself.
 *
 * The defaults are conservative and derived: elevated art carries its own light so it may only turn
 * a little, vegetation in plan is free to turn, everything else stays as photographed. Anything a
 * family knows better — that a gravel is isotropic and may be quarter-turned and mirrored, that a
 * bark is over-saturated at source — it states on its own `render` field, which is spread last.
 * There used to be a set of eight texture ids and one saturation literal in here; a policy about a
 * family belongs on the family.
 */
export function assetQuality(id: AssetId): AssetRenderQuality {
  const family: AssetFamily = ASSET_FAMILIES[id];
  return {
    lighting: family.camera === 'elevated' && family.kind === 'sprite' ? 'upper-left' : 'neutral',
    cameraCompliance: 'declared',
    groundShadow: family.taxon.group === 'effect' ? 'effect' : 'unverified',
    rotation:
      family.camera === 'elevated'
        ? 'limited'
        : family.taxon.group === 'vegetation'
          ? 'free'
          : 'none',
    mirror: false,
    minPx: family.kind === 'sprite' ? 2 : 4,
    preferredMaxPxPerMetre: Math.min(200, family.sizePx.w / family.metres.w),
    replacement:
      family.taxon.group === 'effect'
        ? 'ready'
        : family.camera === 'elevated' || family.kind !== 'sprite' || elevatedTwin(id)
          ? 'review'
          : 'needed',
    saturation: 1,
    ...family.render,
  };
}

export function assetQualityAudit(id: AssetId) {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const variants = catalogueVariants(id);
  const twin = elevatedTwin(id);
  const frame = family.camera === 'elevated' ? elevatedFrame(family) : family.metres;
  return {
    id,
    camera: family.camera ?? 'plan',
    footprint: family.metres,
    anchor: assetAnchor(id),
    elevatedTwin: twin,
    elevatedAvailable: twin ? catalogueVariants(twin).length : 0,
    quality: assetQuality(id),
    pixelsPerMetre: variants.map((entry) => ({
      variant: entry.variant,
      x: entry.widthPx / frame.w,
      y: entry.heightPx / frame.h,
    })),
  };
}
