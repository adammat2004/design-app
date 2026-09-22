import { z } from 'zod';

/**
 * What a roof is covered with.
 *
 * A leaf module with no imports, for the reason `zone-id.ts` is one: `site.ts` needs the schema to
 * put it on the house, and the renderer needs the type to pick a palette and a skin — putting it in
 * either of those makes the other import a file it has no other business with.
 *
 * Three answers, because at the scale a garden plan is read there are three: a dark slate, a dark
 * tile and a red one. A finer catalogue would be a distinction nobody can see at 1:100, and every
 * entry has to be answerable by somebody looking out of their own back door.
 *
 * **Nothing measures this.** It reaches the roof painter and stops; deleting it leaves every area,
 * quantity, validation and placement identical.
 */
export const RoofMaterialSchema = z.enum(['slate', 'dark-tile', 'red-tile']);
export type RoofMaterial = z.infer<typeof RoofMaterialSchema>;

export const DEFAULT_ROOF_MATERIAL: RoofMaterial = 'slate';

/** What each covering is called where a user picks one. */
export const ROOF_MATERIAL_LABELS: Record<RoofMaterial, string> = {
  slate: 'Slate',
  'dark-tile': 'Dark tile',
  'red-tile': 'Red tile',
};
