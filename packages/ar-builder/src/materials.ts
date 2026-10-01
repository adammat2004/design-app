import type { ARCategory, ARMaterial } from '@garden-studio/ar-contract';
import { findMaterial, STRUCTURE_FINISHES, type StructureFinishId } from '@garden-studio/schema';
import type { AppearanceRole, BuildOptions } from './types.js';

/** Neutral colours for a thing the caller has no appearance for. Deliberately plain. */
const NEUTRAL: Record<string, string> = {
  lawn: '#6a8f47',
  planting: '#5b4a3a',
  shrub: '#4f6b3a',
  paving: '#a8a296',
  decking: '#8a6a4a',
  gravel: '#b9ae98',
  path: '#9d968a',
  water: '#4f7784',
  structure: '#8b7355',
  steps: '#a8a296',
  retaining: '#8f877b',
  edging: '#8a8278',
  boundary: '#9a8460',
  // Rendered masonry: the tone the structure editor has always drawn a house's walls in.
  house: '#d9d1c3',
  existing: '#8d8d8d',
};

/** Which appearance role a key's prefix asks for; anything else has no plan material. */
const ROLES: Record<string, AppearanceRole> = {
  material: 'surface',
  foliage: 'foliage',
  boundary: 'boundary',
  roof: 'roof',
};

/**
 * The scene's material table, filled as nodes ask for materials.
 *
 * A key names what is being coloured: `material:<id>` an element's ground, `foliage:<id>` the plants
 * in a bed of it, `boundary:<kind>[:detail|:cap]` a part of a boundary, `roof:<covering>` a roof.
 * The caller's `appearance` answers each by role; the builder only holds neutral fallbacks, because
 * colour is the caller's (the web's palette) and a second copy here would be a second answer.
 */
export class MaterialTable {
  private readonly entries = new Map<string, ARMaterial>();

  constructor(private readonly appearance?: BuildOptions['appearance']) {}

  /** Registers a material by key and returns the key. `neutral` overrides the category's fallback. */
  use(key: string, category: ARCategory, neutral?: string): string {
    if (this.entries.has(key)) return key;
    const [prefix = '', ...rest] = key.split(':');
    const materialId = rest.join(':');
    const role = ROLES[prefix] ?? null;
    const look = role ? (this.appearance?.(materialId, role) ?? null) : null;
    this.entries.set(key, {
      id: key,
      label: look?.label ?? findMaterial(materialId)?.label ?? (materialId || key),
      baseColor: look?.baseColor ?? neutral ?? NEUTRAL[category] ?? '#9a9a9a',
      roughness: look?.roughness ?? 0.9,
      metalness: look?.metalness ?? 0,
      texture: look?.texture ?? null,
      ...(look?.tones && look.tones.length > 0 ? { tones: look.tones } : {}),
    });
    return key;
  }

  /** A structure finish, straight from `STRUCTURE_FINISHES` — which is shaped like `ARMaterial`. */
  finish(id: StructureFinishId): string {
    const key = `finish:${id}`;
    if (!this.entries.has(key)) {
      const finish = STRUCTURE_FINISHES[id];
      this.entries.set(key, {
        id: key,
        label: finish.label,
        baseColor: finish.baseColor,
        roughness: finish.roughness,
        metalness: finish.metalness,
        texture:
          'texture' in finish && finish.texture
            ? { key: finish.texture.key, tileSizeM: finish.texture.tileSizeM }
            : null,
      });
    }
    return key;
  }

  tile(key: string): number {
    return this.entries.get(key)?.texture?.tileSizeM ?? 1;
  }

  table(): Record<string, ARMaterial> {
    return Object.fromEntries(this.entries);
  }
}
