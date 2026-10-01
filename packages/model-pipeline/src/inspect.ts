import type { Document } from '@gltf-transform/core';
import { getBounds, listTextureSlots } from '@gltf-transform/functions';

/**
 * What a GLB contains, measured — the numbers every later decision reads: whether it is over
 * budget, which way it faces, how big it is, whether its material will render as metal.
 */
export interface Inspection {
  counts: {
    scenes: number;
    nodes: number;
    meshes: number;
    primitives: number;
    materials: number;
    textures: number;
    animations: number;
    skins: number;
    cameras: number;
    triangles: number;
    vertices: number;
  };
  /** Of the default scene, in the file's own units and axes. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  size: [number, number, number];
  extensionsUsed: string[];
  textures: {
    name: string;
    slots: string[];
    mimeType: string;
    width: number;
    height: number;
    bytes: number;
  }[];
  materials: {
    name: string;
    metallicFactor: number;
    roughnessFactor: number;
    doubleSided: boolean;
    alphaMode: string;
    hasBaseColorTexture: boolean;
    hasMetallicRoughnessTexture: boolean;
    hasNormalTexture: boolean;
    hasEmissiveTexture: boolean;
  }[];
  /** The larger side of the largest texture, in pixels. */
  maxTexturePx: number;
}

/** Triangles drawn, counting only triangle-list primitives (mode 4) — which is all Meshy writes. */
export function inspect(document: Document): Inspection {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      const position = primitive.getAttribute('POSITION');
      vertices += position?.getCount() ?? 0;
      if (primitive.getMode() !== 4) continue;
      const count = primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }

  const box = scene
    ? getBounds(scene)
    : {
        min: [0, 0, 0],
        max: [0, 0, 0],
      };
  const min = [box.min[0]!, box.min[1]!, box.min[2]!] as [number, number, number];
  const max = [box.max[0]!, box.max[1]!, box.max[2]!] as [number, number, number];

  const textures = root.listTextures().map((texture) => {
    const [width, height] = texture.getSize() ?? [0, 0];
    return {
      name: texture.getName(),
      slots: listTextureSlots(texture),
      mimeType: texture.getMimeType(),
      width,
      height,
      bytes: texture.getImage()?.byteLength ?? 0,
    };
  });

  return {
    counts: {
      scenes: root.listScenes().length,
      nodes: root.listNodes().length,
      meshes: root.listMeshes().length,
      primitives,
      materials: root.listMaterials().length,
      textures: textures.length,
      animations: root.listAnimations().length,
      skins: root.listSkins().length,
      cameras: root.listCameras().length,
      triangles,
      vertices,
    },
    bounds: { min, max },
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName),
    textures,
    materials: root.listMaterials().map((material) => ({
      name: material.getName(),
      metallicFactor: material.getMetallicFactor(),
      roughnessFactor: material.getRoughnessFactor(),
      doubleSided: material.getDoubleSided(),
      alphaMode: material.getAlphaMode(),
      hasBaseColorTexture: material.getBaseColorTexture() !== null,
      hasMetallicRoughnessTexture: material.getMetallicRoughnessTexture() !== null,
      hasNormalTexture: material.getNormalTexture() !== null,
      hasEmissiveTexture: material.getEmissiveTexture() !== null,
    })),
    maxTexturePx: Math.max(
      0,
      ...textures.map((texture) => Math.max(texture.width, texture.height)),
    ),
  };
}
