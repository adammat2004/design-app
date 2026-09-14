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

/** Only isotropic ground textures are allowed to turn. Boards, stripes and baked light are not. */
const TURNABLE = new Set<AssetId>(['tex-standard-turf', 'tex-hardwearing-turf', 'tex-soil',
  'tex-gravel-paving', 'tex-decorative-gravel', 'tex-bark-mulch', 'tex-play-bark', 'tex-slate-chippings']);

export function assetQuality(id: AssetId): AssetRenderQuality {
  const family: AssetFamily = ASSET_FAMILIES[id];
  return {
    lighting: family.camera === 'elevated' && family.kind === 'sprite' ? 'upper-left' : 'neutral',
    cameraCompliance: 'declared',
    groundShadow: family.taxon.group === 'effect' ? 'effect' : 'unverified',
    rotation: TURNABLE.has(id) ? 'quarter-turn' : family.camera === 'elevated' ? 'limited' :
      family.taxon.group === 'vegetation' ? 'free' : 'none',
    mirror: TURNABLE.has(id), minPx: family.kind === 'sprite' ? 2 : 4,
    preferredMaxPxPerMetre: Math.min(200, family.sizePx.w / family.metres.w),
    replacement: family.taxon.group === 'effect' ? 'ready' : family.camera === 'elevated' || family.kind !== 'sprite' ||
      elevatedTwin(id) ? 'review' : 'needed',
    saturation: id === 'tex-play-bark' ? 0.68 : 1,
    ...family.render,
  };
}

export function assetQualityAudit(id: AssetId) {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const variants = catalogueVariants(id);
  const twin = elevatedTwin(id);
  const frame = family.camera === 'elevated' ? elevatedFrame(family) : family.metres;
  return { id, camera: family.camera ?? 'plan', footprint: family.metres, anchor: assetAnchor(id),
    elevatedTwin: twin, elevatedAvailable: twin ? catalogueVariants(twin).length : 0,
    quality: assetQuality(id), pixelsPerMetre: variants.map((entry) => ({ variant: entry.variant,
      x: entry.widthPx / frame.w, y: entry.heightPx / frame.h })) };
}
