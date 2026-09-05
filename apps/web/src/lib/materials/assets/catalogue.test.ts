import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_FAMILIES, ASSET_IDS, assetFile, type AssetFamily, type AssetId } from './asset-spec';
import { CATALOGUE_VERSION, catalogueEntries, catalogueVariants } from './catalogue';
import {
  CANOPY_SPRITES,
  CONTACT_SHADOW_SPRITE,
  materialAssets,
  MATERIAL_ASSETS,
} from './material-assets';

/**
 * The catalogue is generated, the spec is hand-written, and the files are on disk: three things
 * that can drift apart quietly. Each test here is one seam between two of them.
 */

const PUBLIC_ASSETS = join(__dirname, '..', '..', '..', '..', 'public', 'assets');

describe('the catalogue', () => {
  it('names only families the spec knows, at variants the spec allows', () => {
    for (const entry of catalogueEntries()) {
      const family = ASSET_FAMILIES[entry.id];
      expect(family, entry.id).toBeDefined();
      expect(entry.variant).toBeLessThanOrEqual(family.variants);
      expect(entry.file).toBe(assetFile(entry.id, entry.variant));
    }
  });

  it('points at files that exist', () => {
    for (const entry of catalogueEntries()) {
      expect(existsSync(join(PUBLIC_ASSETS, entry.file)), entry.file).toBe(true);
    }
  });

  it('records what the renderer reads for each kind', () => {
    for (const entry of catalogueEntries()) {
      const { kind } = ASSET_FAMILIES[entry.id];
      if (kind === 'sprite') expect(entry.opaqueRadiusRatio, entry.file).toBeGreaterThan(0);
      // A ratio against the tile's own grain: 1 is seamless, and the tool blends anything past 1.5.
      if (kind === 'texture') expect(entry.seamScore, entry.file).toBeLessThanOrEqual(1.6);
    }
  });

  it('has a version that is not "none" once anything was generated', () => {
    if (catalogueEntries().length > 0) expect(CATALOGUE_VERSION).not.toBe('none');
  });
});

describe('the material mapping', () => {
  it('refers only to families of the right kind', () => {
    for (const [material, assets] of Object.entries(MATERIAL_ASSETS)) {
      if (assets.face) expect(ASSET_FAMILIES[assets.face].kind, material).toBe('face');
      if (assets.texture) expect(ASSET_FAMILIES[assets.texture].kind, material).toBe('texture');
      /*
       * Resolved through the query, not read off a list. This is the assertion that the taxonomy
       * has to keep earning: a material asks for "perennials", and every family that answers must
       * actually be a sprite — a texture classified as vegetation by mistake would otherwise be
       * handed to the scatter painter as a plant.
       */
      for (const sprite of materialAssets(material)?.sprites ?? []) {
        expect(ASSET_FAMILIES[sprite].kind, material).toBe('sprite');
      }

      // And it must find something. An empty answer is a query nobody has noticed went stale.
      if (assets.sprites) {
        expect(materialAssets(material)?.sprites ?? [], material).not.toHaveLength(0);
      }
      if (assets.flowers) {
        expect(ASSET_FAMILIES[assets.flowers.sprite].kind, material).toBe('sprite');
        expect(assets.flowers.share).toBeGreaterThan(0);
        expect(assets.flowers.share).toBeLessThanOrEqual(1);
      }
    }
    for (const id of CANOPY_SPRITES) expect(ASSET_FAMILIES[id].kind).toBe('sprite');
    const shadow: AssetFamily = ASSET_FAMILIES[CONTACT_SHADOW_SPRITE];
    expect(shadow.procedural).toBe('soft-shadow');
  });

  it('keeps a canopy inside the radius the geometry uses', () => {
    /*
     * `canopySpriteBox` divides the radius by this ratio, so a ratio far from 1 either shrinks the
     * tree to a dot or blows it up past its circle. The generator fills its frame; the
     * post-processing trims to the alpha; so this should sit close to 1 for every canopy.
     */
    for (const id of CANOPY_SPRITES) {
      for (const entry of catalogueVariants(id)) {
        expect(entry.opaqueRadiusRatio, entry.file).toBeGreaterThan(0.7);
        expect(entry.opaqueRadiusRatio, entry.file).toBeLessThan(1.2);
      }
    }
  });
});

describe('the spec', () => {
  it('gives every family a real size and at least one variant', () => {
    for (const id of ASSET_IDS) {
      const family = ASSET_FAMILIES[id as AssetId];
      expect(family.metres.w).toBeGreaterThan(0);
      expect(family.metres.h).toBeGreaterThan(0);
      expect(family.variants).toBeGreaterThanOrEqual(1);
      expect(family.prompt.length).toBeGreaterThan(20);
      // Only sprites can be transparent; a transparent gravel tile is a hole in the ground.
      if (family.kind !== 'sprite') expect(family.transparent).toBe(false);
    }
  });
});
