import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from 'three';
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
