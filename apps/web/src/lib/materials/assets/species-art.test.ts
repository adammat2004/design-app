import { describe, expect, it } from 'vitest';
import { PLANT_SPECIES } from '@garden-studio/schema';
import { ASSET_FAMILIES, type AssetId } from './asset-spec';

/**
 * Every species is drawn by a picture that already exists. The catalogue names its family as a plain
 * string, because the manifest lives here and the schema may not import it — so this is the check
 * that the string is a family, and the variant one it actually has.
 */
describe('species art', () => {
  it('pins every species to a real family and variant', () => {
    for (const species of PLANT_SPECIES) {
      const family = ASSET_FAMILIES[species.art.family as AssetId];
      expect(family, `${species.id} → ${species.art.family}`).toBeTruthy();
      expect(species.art.variant, species.id).toBeLessThanOrEqual(family.variants);
    }
  });
});
