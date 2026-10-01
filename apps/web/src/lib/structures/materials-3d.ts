import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { structureFinish, type StructureFinishId } from '@garden-studio/schema';
import { CUSHION_SET, FLOOR_DETAIL, FURNITURE_SETS, NORMAL_SCALE, PANEL_SET } from './pbr-library';
import { pbrSet, secondChannel, type PbrSet } from './pbr-textures';
import type { PbrSetId } from './pbr/pbr-spec';

/**
 * The colour a textured material is multiplied by so its average is the swatch: the finish's linear
 * colour over the albedo's measured mean, channel by channel. Capped at 4, so a set far darker than
 * its finish brightens and does not blow out.
 */
export function calibratedColour(swatch: Color, mean: readonly [number, number, number]): Color {
  return new Color().setRGB(
    Math.min(swatch.r / Math.max(mean[0], 1e-3), 4),
    Math.min(swatch.g / Math.max(mean[1], 1e-3), 4),
    Math.min(swatch.b / Math.max(mean[2], 1e-3), 4),
  );
}

/** The roughness a textured material is set to so the map's average is the finish's roughness. */
export function calibratedRoughness(roughness: number, meanRoughness: number): number {
  return Math.min(roughness / Math.max(meanRoughness, 1e-3), 2);
}

/**
 * Dresses a flat material in a set from the 3D library once the set has loaded, in place — the same
 * object every mesh already holds, so nothing re-renders and nothing waits. A set that never arrives
 * leaves the material exactly as it was.
 *
 * **The finish's numbers stay the truth.** The albedo was packed to a known mean and the catalogue
 * records the mean it measured, so the colour is set to `swatch ÷ mean` channel by channel: the
 * textured surface *averages* to the swatch the user chose, and the photograph is only the grain round
 * it. Roughness the same way, through the ORM's green channel. Metalness is left as the finish's own
 * number, because every finish here is uniformly metal or not; ambient occlusion comes from the red.
 *
 * `detailOnly` skips the colour even where the set has one; `channel` 1 reads the maps through the
 * mesh's second UV set, which is how a floor takes relief under the plan painter's raster.
 */
function dress(
  material: MeshStandardMaterial,
  key: PbrSetId,
  {
    colour,
    roughness,
    detailOnly = false,
    channel = 0,
  }: {
    colour: Color;
    roughness: number;
    detailOnly?: boolean;
    channel?: 0 | 1;
  },
): void {
  void pbrSet(key)
    .start()
    .then((set: PbrSet | null) => {
      if (!set) return;
      const read = (texture: Texture) => (channel === 1 ? secondChannel(texture) : texture);
      const mean = set.entry.meanLinearColour;
      if (!detailOnly && set.albedo && mean) {
        material.map = read(set.albedo);
        material.color.copy(calibratedColour(colour, mean));
      }
      material.normalMap = read(set.normal);
      const scale = NORMAL_SCALE[key];
      material.normalScale.set(scale, scale);
      material.roughnessMap = read(set.orm);
      material.roughness = calibratedRoughness(roughness, set.entry.meanRoughness);
      material.aoMap = read(set.orm);
      material.needsUpdate = true;
    });
}

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
const cache = new Map<string, Material>();

export function materialForFinish(
  id: StructureFinishId,
  { detail = true }: { detail?: boolean } = {},
): Material {
  const key = `${id}:${detail ? 'detail' : 'flat'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const finish = structureFinish(id);
  const color = new Color(finish.baseColor);
  let material: MeshStandardMaterial;

  if (finish.opacity !== undefined) {
    /*
     * A translucent roof panel: physical rather than standard for the clear coat, which gives the
     * sheet the sheen of the sky that says "polycarbonate" rather than "frosted plastic". Not
     * transmission: that renders the whole opaque scene a second time every frame to refract it, for
     * a panel that is diffusing rather than clear, and plain transparency reads the same. Double-sided,
     * because it is seen from underneath at least as often as from above, and depth-write off so the
     * frame behind it is not punched out.
     */
    material = new MeshPhysicalMaterial({
      color,
      roughness: finish.roughness,
      metalness: finish.metalness,
      transparent: true,
      opacity: finish.opacity,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      side: DoubleSide,
      depthWrite: false,
    });
    // The ribs through a twin-wall sheet: relief only, the sheet's colour is its own.
    if (detail)
      dress(material, PANEL_SET, { colour: color, roughness: finish.roughness, detailOnly: true });
  } else {
    material = new MeshStandardMaterial({
      color,
      roughness: finish.roughness,
      metalness: finish.metalness,
      ...(finish.emissive
        ? { emissive: new Color(finish.emissive), emissiveIntensity: 2.2, toneMapped: false }
        : {}),
    });
    if (detail && finish.texture) {
      dress(material, finish.texture.key as PbrSetId, {
        colour: color,
        roughness: finish.roughness,
      });
    }
  }

  cache.set(key, material);
  return material;
}

/**
 * Galvanised steel: the post shoe a timber post stands in (`partGeometry`'s second geometry group).
 * Not a finish anyone chooses — it is what the frame is fixed with — so it lives here rather than in
 * `STRUCTURE_FINISHES`. Its satin film is the powder-coat set's orange peel turned down, which is near
 * enough to galvanising's spangle at the size a shoe is seen.
 */
export function hardwareMaterial({ detail = true }: { detail?: boolean } = {}): Material {
  const cacheKey = detail ? 'hardware' : 'hardware:flat';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const colour = new Color('#9ea2a3');
  const material = new MeshStandardMaterial({
    color: colour.clone(),
    roughness: 0.42,
    metalness: 0.85,
  });
  if (detail) dress(material, 'powder-coat', { colour, roughness: 0.42 });
  cache.set(cacheKey, material);
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
  const material = new MeshStandardMaterial({
    map: texture,
    color: CONTEXT_TINT.clone(),
    roughness: 0.95,
  });
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
  const colour = new Color(tone.colour);
  const material = new MeshStandardMaterial({
    color: colour.clone(),
    roughness: tone.roughness,
    metalness: tone.metalness,
  });
  const set = FURNITURE_SETS[materialId ?? 'teak-furniture'];
  if (set) dress(material, set, { colour, roughness: tone.roughness });
  contextCache.set(cacheKey, material);
  return material;
}

/** The colour a picked-up piece is outlined in: the editor's own selection green. */
export const PIECE_OUTLINE = '#2f7a4f';

/**
 * Seat pads and cushions: an outdoor fabric, the same on every piece so a set reads as a set. Woven
 * in the pieces inside the structure being edited; plain on furniture in the surroundings, which
 * are context and stay flat.
 */
export function cushionMaterial({ detail = true }: { detail?: boolean } = {}): Material {
  const cacheKey = detail ? 'cushion' : 'cushion:flat';
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;
  const colour = new Color('#ddd6c8');
  const material = new MeshStandardMaterial({ color: colour.clone(), roughness: 0.95 });
  if (detail) dress(material, CUSHION_SET, { colour, roughness: 0.95 });
  contextCache.set(cacheKey, material);
  return material;
}

/**
 * The floor laid inside a structure: the plan painter's raster for its colour and joints, and the
 * floor's own roughness — porcelain is not stone — with relief from the library under it, read
 * through the mesh's `uv1` in metres. The raster material is the caller's (it disposes it with the
 * surface); this only dresses it.
 */
export function dressFloor(material: MeshStandardMaterial, floor: string): void {
  const detail = FLOOR_DETAIL[floor];
  if (!detail) return;
  material.roughness = detail.roughness;
  if (detail.set) {
    dress(material, detail.set, {
      colour: material.color.clone(),
      roughness: detail.roughness,
      detailOnly: true,
      channel: 1,
    });
  }
}
