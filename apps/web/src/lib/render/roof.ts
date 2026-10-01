import { DEFAULT_ROOF_MATERIAL, type RoofMaterial } from '@garden-studio/schema';

/**
 * The roof's geometry is the schema's (`roofFor`, in `packages/schema/src/plan/roof.ts`): the 2D
 * plan, the 3D editor and the AR builder all need the same roof. What it is painted in stays here.
 */
export { roofFor, type RenderRoof, type RoofForm, type RoofOptions, type RoofPlane } from '@garden-studio/schema';

/**
 * The covering. A single restrained default, with the other two named.
 *
 * Unlike the *shape* — which the footprint genuinely constrains — the material is not derivable
 * from anything, so it is **asked** rather than guessed: `HouseFootprint.roofMaterial`, defaulted to
 * slate because a dark neutral recedes and a garden drawing wants the house to sit back. The type
 * lives in the schema so the document and the painter cannot hold two different lists.
 */
export type { RoofMaterial };
export { DEFAULT_ROOF_MATERIAL };

export const ROOF_TONES: Record<RoofMaterial, { base: string; ridge: string }> = {
  slate: { base: '#5a6169', ridge: '#464c53' },
  'dark-tile': { base: '#5d5550', ridge: '#484240' },
  'red-tile': { base: '#8f5a45', ridge: '#6f4436' },
};
