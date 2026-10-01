import type { Document } from '@gltf-transform/core';
import {
  dedup,
  meshopt,
  normals,
  prune,
  quantize,
  reorder,
  simplify,
  tangents,
  textureCompress,
  unweld,
  weld,
} from '@gltf-transform/functions';
import mikktspace from 'mikktspace';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptSimplifier } from './io.js';
import { inspect } from './inspect.js';

/**
 * Bring a normalised model inside the budgets a phone can draw: the AR architecture's ≤15k
 * triangles for a hero object, ≤1024 px textures, and a file a few megabytes at most.
 *
 * What Phase 0 measured this has to do to a Meshy gazebo: 12–14k triangles, already inside the
 * budget, so simplifying is a guard rather than the normal case; three or four 2048² textures, the
 * normal map a 4.7 MB PNG on its own; a 9.9 MB file. Textures down to 1024 px and meshopt took it to
 * 2.5 MB — of which the normal map, still a PNG, was 2.1 MB. So the normal map is written as a JPEG
 * too: a normal map's error shows as a faint grain in the shading, which at garden distance is
 * nothing, and it is the difference between a file a phone downloads and one it waits for.
 *
 * Two things are removed on purpose:
 *
 * - **Emission.** meshy-6 ships an emission map that is 2048² of black. A library model never
 *   glows: a light strip is the procedural structure's business, switched on by the plan.
 * - Nothing else. In particular **the metallic-roughness texture is kept**: Meshy writes
 *   `metallicFactor: 1` and puts the metal in the texture's blue channel, which is near zero for
 *   timber — drop the texture and the timber renders as polished metal. `inspect` reports a material
 *   in that state and `checkBudgets` refuses it.
 */

export interface OptimiseOptions {
  triangleBudget: number;
  maxTexturePx: number;
  /** JPEG quality for colour and packed-channel maps. */
  jpegQuality?: number;
  /** Normal maps as JPEG (the default, and a quarter the size) or lossless PNG. */
  normalFormat?: 'jpeg' | 'png';
}

export interface OptimiseResult {
  simplified: { from: number; to: number } | null;
  removedEmission: number;
  /** MikkTSpace tangents were generated for a normal map that arrived without them. */
  generatedTangents: boolean;
}

export async function optimise(
  document: Document,
  options: OptimiseOptions,
): Promise<OptimiseResult> {
  const root = document.getRoot();

  let removedEmission = 0;
  for (const material of root.listMaterials()) {
    if (material.getEmissiveTexture()) removedEmission += 1;
    material.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
  }

  await document.transform(prune(), dedup(), weld());

  /*
   * Meshy ships a normal map and no tangents, which the validator reports as "runtime-generated
   * tangent space may be non-portable": every renderer then invents its own, and a normal map baked
   * against one tangent space and lit with another shades its bumps from the wrong side. three.js
   * copes; the phone's renderer is not three.js. MikkTSpace is the standard every baker and engine
   * agrees on, and it needs the mesh unwelded while it works.
   */
  let generatedTangents = false;
  if (needsTangents(document)) {
    const lacksNormals = document
      .getRoot()
      .listMeshes()
      .some((mesh) => mesh.listPrimitives().some((primitive) => !primitive.getAttribute('NORMAL')));
    await document.transform(
      ...(lacksNormals ? [normals({ overwrite: false })] : []),
      unweld(),
      tangents({ generateTangents: mikktspace.generateTangents, overwrite: false }),
      weld(),
    );
    generatedTangents = true;
  }

  let simplified: OptimiseResult['simplified'] = null;
  const from = inspect(document).counts.triangles;
  if (from > options.triangleBudget) {
    await document.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: (options.triangleBudget / from) * 0.95,
        error: 0.002,
        lockBorder: false,
      }),
    );
    simplified = { from, to: inspect(document).counts.triangles };
  }

  const quality = options.jpegQuality ?? 85;
  const size: [number, number] = [options.maxTexturePx, options.maxTexturePx];
  await document.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      quality,
      resize: size,
      slots: /^(baseColorTexture|metallicRoughnessTexture|occlusionTexture)$/,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: options.normalFormat ?? 'jpeg',
      quality: Math.min(100, quality + 7),
      resize: size,
      slots: /^normalTexture$/,
    }),
    prune(),
  );
  await compressGeometry(document);

  return { simplified, removedEmission, generatedTangents };
}

/** A primitive with a normal map and texture coordinates but no tangents of its own. */
function needsTangents(document: Document): boolean {
  return document
    .getRoot()
    .listMeshes()
    .some((mesh) =>
      mesh
        .listPrimitives()
        .some(
          (primitive) =>
            primitive.getMaterial()?.getNormalTexture() &&
            primitive.getAttribute('TEXCOORD_0') &&
            !primitive.getAttribute('TANGENT'),
        ),
    );
}

/**
 * Weld, reorder for the vertex cache, quantise and meshopt-compress — the last step of every GLB
 * this repository writes, the furniture models (`tools/assets fetch:models`) and the library models
 * alike, so both are read by the one bundled decoder in three.js.
 */
export async function compressGeometry(document: Document): Promise<void> {
  await document.transform(
    weld(),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
}
