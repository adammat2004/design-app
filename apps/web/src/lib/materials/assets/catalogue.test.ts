import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_FAMILIES, ASSET_IDS, assetFile, type AssetFamily, type AssetId } from './asset-spec';
import {
  CATALOGUE_VERSION,
  CatalogueEntrySchema,
  catalogueEntries,
  catalogueVariants,
} from './catalogue';
import raw from './catalogue.json';
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

  /**
   * On the raw file, not on `catalogueEntries()`: the loader drops an entry whose id the spec no
   * longer knows so an orphan cannot stop the app drawing, which is the right thing at runtime and
   * exactly what a test has to see. Two entries for one file would have the second silently win.
   */
  it('has one entry per file and none for a family that does not exist', () => {
    const seen = new Set<string>();
    for (const entry of raw.assets) {
      const key = `${entry.id}-${entry.variant}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(entry.id in ASSET_FAMILIES, entry.id).toBe(true);
    }
  });

  /**
   * Every treatment ends in a resize to the family's `sizePx` — contain for a sprite, cover for a
   * texture or face — so an entry whose recorded size disagrees with the spec was processed before
   * the spec changed and needs `--reprocess`. The renderer scales by these numbers.
   */
  it('records the size the spec declares', () => {
    for (const entry of catalogueEntries()) {
      const family: AssetFamily = ASSET_FAMILIES[entry.id];
      expect(entry.widthPx, entry.file).toBe(family.sizePx.w);
      expect(entry.heightPx, entry.file).toBe(family.sizePx.h);
    }
  });

  it('never ships a file the QA pass found a defect in', () => {
    for (const entry of catalogueEntries()) {
      expect(entry.processed?.defects ?? [], entry.file).toHaveLength(0);
    }
  });

  it('round-trips the generation and processing records', () => {
    const entry = CatalogueEntrySchema.parse({
      id: 'plant-shrub',
      variant: 1,
      file: 'plan/sprites/plant-shrub-1.webp',
      widthPx: 256,
      heightPx: 256,
      meanColour: '#4a6b3a',
      opaqueRadiusRatio: 0.98,
      generation: {
        model: 'gpt-image-2.5-sunburst-2026-09-08',
        quality: 'medium',
        requestedSize: { w: 1024, h: 1024 },
        rawSize: { w: 1024, h: 1024 },
        specVersion: '2.0',
        promptHash: 'abcdef012345',
        generatedAt: '2026-09-17T10:00:00.000Z',
        rawHash: '0123456789ab',
      },
      processed: {
        postprocessVersion: '2',
        at: '2026-09-17T10:00:05.000Z',
        warnings: ['soft edge is 30% off the interior colour — a halo'],
        defects: [],
      },
    });
    expect(entry.generation?.specVersion).toBe('2.0');
    expect(entry.processed?.warnings).toHaveLength(1);
    // And the record written before either existed still parses.
    expect(() =>
      CatalogueEntrySchema.parse({
        id: 'tex-soil',
        variant: 1,
        file: 'plan/textures/tex-soil-1.webp',
        widthPx: 512,
        heightPx: 512,
        meanColour: '#5a4a3a',
        seamScore: 1.1,
      }),
    ).not.toThrow();
  });

  /**
   * What each kind has to record, and **the two cameras record different things**.
   *
   * A plan sprite is centred and inscribed in a circle, so the number the renderer needs is how far
   * its opaque pixels reach from the middle. An elevated one is framed from its *foot* and is not
   * square — a tree's pixels reach much further up than down — so a single radius from the centre
   * cannot describe it, and a box is what the QA pass checks the framing against instead. Asking
   * every sprite for a radius was the plan camera's assumption left standing when a second one
   * arrived.
   */
  it('records what the renderer reads for each kind', () => {
    for (const entry of catalogueEntries()) {
      const family: AssetFamily = ASSET_FAMILIES[entry.id];

      if (family.kind === 'sprite' && family.camera === 'elevated') {
        expect(entry.opaqueBounds, entry.file).toBeDefined();
        expect(entry.opaqueBounds!.maxX, entry.file).toBeGreaterThan(entry.opaqueBounds!.minX);
        expect(entry.opaqueBounds!.maxY, entry.file).toBeGreaterThan(entry.opaqueBounds!.minY);
        /*
         * `footAlpha` is **recorded, not judged**, and that distinction cost three false failures
         * before it was understood. A high value means the object is as wide where it meets the
         * ground as its frame is — which is a ground plane for a sofa and simply the truth for a
         * planter, a raised bed or a trampoline, each of which *is* a box or a disc. Telling those
         * apart needs the pixels either side of the foot, so the judgement lives in the tool's
         * `spreadsAtTheFoot` and what the catalogue can honestly assert is that the number is there.
         */
        expect(entry.footAlpha, entry.file).toBeGreaterThanOrEqual(0);
        expect(entry.footAlpha, entry.file).toBeLessThanOrEqual(1);
        continue;
      }

      if (family.kind === 'sprite') expect(entry.opaqueRadiusRatio, entry.file).toBeGreaterThan(0);
      // A ratio against the tile's own grain: 1 is seamless, and the tool blends anything past 1.5.
      if (family.kind === 'texture') expect(entry.seamScore, entry.file).toBeLessThanOrEqual(1.6);
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
      expect(family.subject.length).toBeGreaterThan(20);
      // Only sprites can be transparent; a transparent gravel tile is a hole in the ground.
      if (family.kind !== 'sprite') expect(family.transparent).toBe(false);
    }
  });
});
