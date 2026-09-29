import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { structureFinish, type StructureFinishId } from '@garden-studio/schema';

/**
 * A structure finish as a physically based three.js material — the only place renderer values are
 * made.
 *
 * `STRUCTURE_FINISHES` in `packages/schema` is the description: a base colour, a roughness, a
 * metalness, and where needed an emission or an opacity. It is deliberately shaped like the AR
 * contract's `ARMaterial`, so the AR scene builder maps it one to one. This module is the web's own
 * mapping of that description onto three.js, and no React component writes a colour, a roughness or
 * a `MeshStandardMaterial` of its own — change how dark aluminium looks here and every part in every
 * structure follows.
 *
 * Cached per finish and shared across every mesh that uses it, so a pergola's thirty rafters are one
 * material rather than thirty; three.js batches state changes by material, and a cache miss per frame
 * would allocate. Never disposed, because there are about ten of them for the life of the page.
 */
const cache = new Map<StructureFinishId, Material>();

export function materialForFinish(id: StructureFinishId): Material {
  const cached = cache.get(id);
  if (cached) return cached;

  const finish = structureFinish(id);
  const color = new Color(finish.baseColor);
  let material: Material;

  if (finish.opacity !== undefined) {
    /*
     * A translucent roof panel: physical rather than standard so it can transmit a little light
     * rather than only fading. Double-sided, because it is seen from underneath at least as often
     * as from above, and depth-write off so the frame behind it is not punched out.
     */
    material = new MeshPhysicalMaterial({
      color,
      roughness: finish.roughness,
      metalness: finish.metalness,
      transparent: true,
      opacity: finish.opacity,
      transmission: 0.25,
      side: DoubleSide,
      depthWrite: false,
    });
  } else {
    material = new MeshStandardMaterial({
      color,
      roughness: finish.roughness,
      metalness: finish.metalness,
      ...(finish.emissive
        ? { emissive: new Color(finish.emissive), emissiveIntensity: 2.2, toneMapped: false }
        : {}),
    });
  }

  cache.set(id, material);
  return material;
}

/* ---------------------------------------------------------------- the surroundings */

/** The viewport's sky, which the surroundings are pulled a little towards. */
export const CONTEXT_BACKGROUND = '#e9eee8';

/**
 * How far the surroundings are muted towards the sky: a touch, so the structure being edited still
 * leads. It was 0.22 while the surroundings were blocks and blobs and the mute was doing the work of
 * hierarchy; now that plants, fences and paving carry their own detail, a heavy mute only washes the
 * garden out.
 */
const CONTEXT_MUTE = 0.08;

/** What a textured surface is multiplied by: the same mute, applied to a picture. */
const CONTEXT_TINT = new Color('#ffffff').lerp(new Color(CONTEXT_BACKGROUND), CONTEXT_MUTE * 1.4);

const contextCache = new Map<string, Material>();

/**
 * A ground surface around the structure: the plan's own texture where it has one, tiled in world
 * metres (the geometry's UVs are metres over the tile size, so the texture repeats once per UV unit),
 * or its flat colour; softly muted either way, and matt.
 *
 * Cached per material and texture for the life of the page, like the finishes: a garden has a
 * dozen ground materials, not a thousand.
 */
export function contextSurfaceMaterial(key: string, texture: Texture | null, colour: string): Material {
  const cacheKey = `surface:${key}:${texture ? texture.uuid : 'flat'}`;
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;

  let material: MeshStandardMaterial;
  if (texture) {
    // A clone, because `useTexture` hands one texture per URL to the whole page.
    const map = texture.clone();
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
    material = new MeshStandardMaterial({ map, color: CONTEXT_TINT.clone(), roughness: 1 });
  } else {
    material = new MeshStandardMaterial({ color: muted(colour), roughness: 1 });
  }
  contextCache.set(cacheKey, material);
  return material;
}

/** A solid around the structure — a fence, a wall, a shed, a canopy — in a muted flat tone. */
export function contextSolidMaterial(colour: string, roughness = 0.9): Material {
  const cacheKey = `solid:${colour}:${roughness}`;
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;
  const material = new MeshStandardMaterial({ color: muted(colour), roughness });
  contextCache.set(cacheKey, material);
  return material;
}

function muted(colour: string): Color {
  return new Color(colour).lerp(new Color(CONTEXT_BACKGROUND), CONTEXT_MUTE);
}

/**
 * Tones for the things around a structure that have no material of their own in the plan. Here, not
 * in a component, for the reason the finishes are: one place says what a render colour is.
 */
/**
 * A ground surface painted by the plan's own surface painter. Not cached, because the texture is
 * this surface's alone — the caller disposes both when the surface changes.
 */
export function rasterSurfaceMaterial(canvas: HTMLCanvasElement): {
  material: MeshStandardMaterial;
  texture: CanvasTexture;
} {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  const material = new MeshStandardMaterial({ map: texture, color: CONTEXT_TINT.clone(), roughness: 0.95 });
  return { material, texture };
}

/**
 * Foliage: the crown geometries carry their own light-to-dark shading as vertex colours, and this
 * multiplies it by the plant's colour. With `instanced`, the colour comes per instance instead and
 * the material's own is white.
 */
export function foliageMaterial(colour: string | null): Material {
  const cacheKey = `foliage:${colour ?? 'instanced'}`;
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;
  const material = new MeshStandardMaterial({
    color: colour ? muted(colour) : new Color('#ffffff'),
    vertexColors: true,
    roughness: 0.95,
  });
  contextCache.set(cacheKey, material);
  return material;
}

export const CONTEXT_TONES = {
  /** Rendered masonry: the plan draws the house as a footprint and says nothing about its walls. */
  houseWall: '#d9d1c3',
  trunk: '#6b5643',
  tree: '#5c7c46',
  conifer: '#3e5e37',
  shrub: '#6f8c52',
  furniture: '#8d8173',
  /** A window from outside in daylight: the sky reflected in dark glass, not a hole. */
  glass: '#94a8b2',
  door: '#4a4038',
  /** Painted timber or uPVC round a door or a window. */
  frame: '#eceae4',
} as const;

/** The furniture finishes, as they read in daylight: oiled teak, woven rattan, dark powder coat. */
const FURNITURE_TONES: Record<string, { colour: string; roughness: number; metalness: number }> = {
  'teak-furniture': { colour: '#9a6b43', roughness: 0.7, metalness: 0 },
  'rattan-furniture': { colour: '#a8845a', roughness: 0.85, metalness: 0 },
  'steel-furniture': { colour: '#3b3f42', roughness: 0.45, metalness: 0.6 },
};

/**
 * A piece of furniture inside the structure being edited, at full colour — it is part of what is
 * being edited, not the surroundings, so it is not muted.
 */
export function furnitureMaterial(materialId: string | undefined): Material {
  const tone = FURNITURE_TONES[materialId ?? ''] ?? FURNITURE_TONES['teak-furniture']!;
  const cacheKey = `furniture:${materialId ?? 'teak-furniture'}`;
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;
  const material = new MeshStandardMaterial({
    color: new Color(tone.colour),
    roughness: tone.roughness,
    metalness: tone.metalness,
  });
  contextCache.set(cacheKey, material);
  return material;
}

/** The colour a picked-up piece is outlined in: the editor's own selection green. */
export const PIECE_OUTLINE = '#2f7a4f';

/** Seat pads and cushions: an outdoor fabric, the same on every piece so a set reads as a set. */
export function cushionMaterial(): Material {
  const cached = contextCache.get('cushion');
  if (cached) return cached;
  const material = new MeshStandardMaterial({ color: new Color('#ddd6c8'), roughness: 0.95 });
  contextCache.set('cushion', material);
  return material;
}
