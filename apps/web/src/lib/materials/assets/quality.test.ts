import { describe, expect, it } from 'vitest';
import { ASSET_IDS, ASSET_FAMILIES, elevatedFrame } from './asset-spec';
import { assetQuality, assetQualityAudit } from './quality';

describe('renderer-only asset quality policy', () => {
  it('supplies conservative defaults without claiming an unreviewed image passed QA', () => {
    for (const id of ASSET_IDS) {
      const quality = assetQuality(id);
      expect(quality.minPx).toBeGreaterThan(0);
      expect(quality.preferredMaxPxPerMetre).toBeGreaterThan(0);
      expect(quality.cameraCompliance).toBe('declared');
      if (ASSET_FAMILIES[id].taxon.group !== 'effect') expect(quality.groundShadow).toBe('unverified');
    }
  });
  it('allows transforms on isotropic ground, but not directional boards or baked self-light', () => {
    expect(assetQuality('tex-standard-turf')).toMatchObject({ mirror: true, rotation: 'quarter-turn' });
    expect(assetQuality('face-decking-wood')).toMatchObject({ mirror: false, rotation: 'none' });
    expect(assetQuality('vis-tree-deciduous')).toMatchObject({ mirror: false, rotation: 'limited' });
    expect(assetQuality('skin-fence-boards').lighting).toBe('neutral');
  });
  it('audits the resolved anchor and full elevated frame, not just the ground footprint', () => {
    const row = assetQualityAudit('vis-grass');
    const frame = elevatedFrame(ASSET_FAMILIES['vis-grass']);
    expect(row.anchor.y).toBeGreaterThan(0.5);
    expect(row.pixelsPerMetre[0]!.y).toBeCloseTo(ASSET_FAMILIES['vis-grass'].sizePx.h / frame.h);
  });
});
