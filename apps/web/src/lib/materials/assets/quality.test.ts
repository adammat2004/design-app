import { describe, expect, it } from 'vitest';
import { ASSET_IDS, ASSET_FAMILIES } from './asset-spec';
import { assetQuality, assetQualityAudit } from './quality';

describe('renderer-only asset quality policy', () => {
  it('supplies conservative defaults without claiming an unreviewed image passed QA', () => {
    for (const id of ASSET_IDS) {
      const quality = assetQuality(id);
      expect(quality.minPx).toBeGreaterThan(0);
      expect(quality.preferredMaxPxPerMetre).toBeGreaterThan(0);
      if (ASSET_FAMILIES[id].taxon.group !== 'effect')
        expect(quality.groundShadow).toBe('unverified');
    }
  });
  it('allows transforms on isotropic ground, but not directional boards', () => {
    expect(assetQuality('tex-standard-turf')).toMatchObject({
      mirror: true,
      rotation: 'quarter-turn',
    });
    expect(assetQuality('face-decking-wood')).toMatchObject({ mirror: false, rotation: 'none' });
    expect(assetQuality('plant-shrub')).toMatchObject({ mirror: false, rotation: 'free' });
  });
  it('audits pixels per metre against the footprint', () => {
    const row = assetQualityAudit('plant-shrub');
    const family = ASSET_FAMILIES['plant-shrub'];
    expect(row.pixelsPerMetre[0]!.x).toBeCloseTo(family.sizePx.w / family.metres.w);
  });
});
