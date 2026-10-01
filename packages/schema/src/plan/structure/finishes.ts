/**
 * What a structure's parts are finished in, described once for every renderer.
 *
 * Shaped deliberately like `ARMaterial` in `packages/ar-contract` — a label, a base colour, a
 * roughness and a metalness — so the future AR scene builder maps a finish to a scene material one
 * to one, the web configurator builds a physically based material from the same four numbers, and
 * the plan renderer can take its tone from the same colour. **No renderer type appears here**: a
 * finish is data, and turning it into a `MeshStandardMaterial` is the web app's business alone
 * (`apps/web/src/lib/structures/materials-3d.ts`).
 *
 * Keyed by id. The frame finishes are exactly the `MaterialId`s a structure can be made of, because
 * the frame *is* the element's `material`; the rest are roof panels and the light strip, which have
 * no element of their own to carry a material.
 */
export interface StructureFinish {
  label: string;
  /** sRGB hex. */
  baseColor: string;
  /** 0 = mirror, 1 = matt. */
  roughness: number;
  /** 0 = dielectric, 1 = metal. */
  metalness: number;
  /** Light the part gives off, as an sRGB hex. Only the light strip has one. */
  emissive?: string;
  /** 0–1, for a translucent panel. Absent means opaque. */
  opacity?: number;
  /**
   * The material photograph that gives the finish its grain, weave or orange peel, and how many
   * metres one repeat covers. Exactly `ARMaterial.texture`'s shape, so the AR builder maps it with
   * `finish.texture ?? null`. `key` names a set in the 3D library (`pbr-spec.ts` in the web app),
   * never a file: which file draws a key is the renderer's business.
   *
   * **The finish's numbers stay the truth.** A renderer that uses the texture scales it so its
   * average is `baseColor` and `roughness` — the photograph is the variation round the swatch, not a
   * second answer to what colour the finish is. Absent, the finish is flat, as every finish was.
   */
  texture?: { key: string; tileSizeM: number };
}

/** The timber and metal sets. Tile sizes are the photographs' measured size; see `pbr-spec.ts`. */
const OAK = { key: 'timber-oak', tileSizeM: 1.83 } as const;
const PINE = { key: 'timber-pine', tileSizeM: 1.2 } as const;
const PAINTED = { key: 'timber-painted', tileSizeM: 1.2 } as const;
const POWDER_COAT = { key: 'powder-coat', tileSizeM: 1 } as const;

export const STRUCTURE_FINISHES = {
  /* ---- frames: the `MaterialId`s in `MATERIALS.structure` ---- */
  softwood: {
    label: 'Treated softwood',
    baseColor: '#b58e5f',
    roughness: 0.8,
    metalness: 0,
    texture: PINE,
  },
  'painted-timber': {
    label: 'Painted timber',
    baseColor: '#7d8b83',
    roughness: 0.65,
    metalness: 0,
    texture: PAINTED,
  },
  'dark-stained-timber': {
    label: 'Dark-stained timber',
    baseColor: '#4a3a2c',
    roughness: 0.7,
    metalness: 0,
    texture: OAK,
  },
  hardwood: {
    label: 'Natural timber',
    baseColor: '#9a6b43',
    roughness: 0.7,
    metalness: 0,
    texture: OAK,
  },
  'powder-coated-steel': {
    label: 'Powder-coated steel',
    baseColor: '#3b3f42',
    roughness: 0.5,
    metalness: 0.6,
    texture: POWDER_COAT,
  },
  'aluminium-dark': {
    label: 'Dark aluminium',
    baseColor: '#34373a',
    roughness: 0.42,
    metalness: 0.75,
    texture: POWDER_COAT,
  },
  'aluminium-light': {
    label: 'Light aluminium',
    baseColor: '#c9cbc8',
    roughness: 0.38,
    metalness: 0.8,
    texture: POWDER_COAT,
  },
  /* ---- roof coverings ---- */
  /*
   * The covering a timber gazebo is actually sold with: bitumen shingles over a boarded hipped
   * roof. Added for the model library (see CLAUDE.md, "Library models from Meshy"): a model has its
   * covering baked in, and a gazebo roofed in grey shingles could not be described while the only
   * coverings were the frame's own timber, aluminium and polycarbonate. Flat colour with no texture,
   * like the polycarbonate below, until a shingle set earns a place in the PBR library.
   */
  'shingle-dark': {
    label: 'Dark shingles',
    baseColor: '#45484b',
    roughness: 0.9,
    metalness: 0,
  },
  /* ---- roof panels ---- */
  'polycarbonate-opal': {
    label: 'Opal polycarbonate',
    baseColor: '#eef0ec',
    roughness: 0.3,
    metalness: 0,
    opacity: 0.72,
  },
  /* ---- the light strip ---- */
  'warm-led': {
    label: 'Warm LED',
    baseColor: '#fff1d6',
    roughness: 0.4,
    metalness: 0,
    emissive: '#ffcf8a',
  },
} as const satisfies Record<string, StructureFinish>;

export type StructureFinishId = keyof typeof STRUCTURE_FINISHES;

export function isStructureFinish(id: string | undefined): id is StructureFinishId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(STRUCTURE_FINISHES, id);
}

/** The finish itself, widened to the interface so optional fields can be read. */
export function structureFinish(id: StructureFinishId): StructureFinish {
  return STRUCTURE_FINISHES[id];
}
