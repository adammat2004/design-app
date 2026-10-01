import type { Document, mat4 } from '@gltf-transform/core';
import {
  clearNodeTransform,
  dequantize,
  flatten,
  getBounds,
  prune,
  transformMesh,
} from '@gltf-transform/functions';

/**
 * Put a generated model into the scene's convention: metres, +Y up, the base centred on the origin,
 * the front towards +Z — the promise a library entry makes, so no renderer applies a correction of
 * its own.
 *
 * What Phase 0 measured Meshy to return, and so what this has to undo (CLAUDE.md, "Library models
 * from Meshy"): +Y up already, sides along X and Z, **centred on the bounding box rather than the
 * base**, and **normalised so the largest side is about 1.9** rather than in any real unit. So:
 *
 * 1. **Bake** every node's transform into its mesh and drop what is not geometry — animations,
 *    skins, cameras, lights. A library model is one static object.
 * 2. **Turn** a quarter at a time about +Y, by `frontYawDeg`, where the person reviewing it said
 *    the front is not towards +Z. Never inferred: a gazebo has no front, and a shed's door side is
 *    a judgement a person makes once, in review.
 * 3. **Stand it on the origin**: the base's centre at `[0, 0, 0]`.
 * 4. **Scale it uniformly** so its plan `contain`s `nominal` — the width and depth the spec asked
 *    for. Uniform, because the model's own proportions are the thing being bought; stretching it to
 *    the nominal height as well would squash a roof that came out a little tall. How far the height
 *    then is from `nominal.height` is reported, and a large gap is a warning to look at.
 *
 * Axis-aligned by construction: the model is turned only by quarter turns, so its box is still its
 * box. A model generated at an angle is a model to reject, not one to straighten by guesswork.
 */

export interface NormaliseOptions {
  /** Width (X), depth (Z) and height (Y) in metres the model is published at. */
  nominal: { width: number; depth: number; height: number };
  /** Quarter turns about +Y applied before anything else: 0, 90, 180 or 270. */
  frontYawDeg?: number;
  /**
   * Stretch it upright to `nominal.height` after the uniform scale. **Never the default, and only
   * a person chooses it**: a model's proportions are what was bought, and a stretched roof or brace
   * can look wrong. It exists because image-to-3D's least reliable output is height — the first
   * modern gazebo came back at 1.87 m for 2.7 m asked, which no gazebo could ever be drawn with — and
   * for a design of straight extrusions (posts, slats, a flat roof) an upright stretch reads as the
   * taller product it should have been.
   */
  fitHeight?: boolean;
}

export interface NormaliseResult {
  /** The uniform scale applied, file units to metres. */
  scale: number;
  /** Width, height, depth after normalising, in metres. */
  naturalSize: [number, number, number];
  /** `naturalSize[1] / nominal.height`: 1 is exact, the proportions Meshy gave otherwise. */
  heightRatio: number;
  /** The upright stretch applied by `fitHeight` (1 when none): what the model was, against what it is. */
  heightStretch: number;
  removed: { animations: number; skins: number; cameras: number };
}

export async function normalise(
  document: Document,
  options: NormaliseOptions,
): Promise<NormaliseResult> {
  const yaw = options.frontYawDeg ?? 0;
  if (![0, 90, 180, 270].includes(yaw)) {
    throw new Error(`frontYawDeg must be a quarter turn, not ${yaw}`);
  }
  const root = document.getRoot();

  const removed = {
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
  };
  for (const animation of root.listAnimations()) animation.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const camera of root.listCameras()) camera.dispose();
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_lights_punctual') extension.dispose();
  }

  // Quantised positions cannot take an arbitrary transform, so float everything first.
  await document.transform(dequantize(), flatten());

  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('The model has no scene');
  root.setDefaultScene(scene);
  for (const other of root.listScenes()) if (other !== scene) other.dispose();

  // After `flatten` every mesh node is a child of the scene, so its local transform is its world.
  for (const node of root.listNodes()) {
    if (node.getMesh()) clearNodeTransform(node);
  }
  await document.transform(prune({ keepLeaves: false }));

  if (root.listMeshes().length === 0) throw new Error('The model has no geometry');

  const before = getBounds(scene);
  const centre: [number, number, number] = [
    (before.min[0]! + before.max[0]!) / 2,
    before.min[1]!,
    (before.min[2]! + before.max[2]!) / 2,
  ];
  const turned = yaw === 90 || yaw === 270;
  const spanX = turned ? before.max[2]! - before.min[2]! : before.max[0]! - before.min[0]!;
  const spanZ = turned ? before.max[0]! - before.min[0]! : before.max[2]! - before.min[2]!;
  if (!(spanX > 0 && spanZ > 0) || !Number.isFinite(spanX + spanZ)) {
    throw new Error('The model has no extent on plan');
  }
  const scale = Math.min(options.nominal.width / spanX, options.nominal.depth / spanZ);

  const matrix = compose(scale, (yaw * Math.PI) / 180, centre);
  for (const mesh of root.listMeshes()) transformMesh(mesh, matrix);

  let heightStretch = 1;
  if (options.fitHeight) {
    const height = getBounds(scene).max[1]!;
    if (!(height > 0)) throw new Error('The model has no height to stretch');
    heightStretch = options.nominal.height / height;
    // The base is on y = 0, so a scale about the origin keeps it there.
    for (const mesh of root.listMeshes()) {
      transformMesh(mesh, [1, 0, 0, 0, 0, heightStretch, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
  }

  const after = getBounds(scene);
  const naturalSize: [number, number, number] = [
    after.max[0]! - after.min[0]!,
    after.max[1]! - after.min[1]!,
    after.max[2]! - after.min[2]!,
  ];
  return {
    scale,
    naturalSize,
    heightRatio: naturalSize[1] / options.nominal.height,
    heightStretch,
    removed,
  };
}

/**
 * `S · R_y(yaw) · T(−centre)` as a column-major 4×4: move the base centre to the origin, turn about
 * +Y (right-handed, so +Z goes towards +X for a positive yaw), then scale.
 */
function compose(scale: number, yaw: number, centre: [number, number, number]): mat4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Snap the quarter turns so a 90° turn does not leave 6e-17 of X in Z.
  const cs = Math.abs(c) < 1e-12 ? 0 : c;
  const sn = Math.abs(s) < 1e-12 ? 0 : s;
  const [cx, cy, cz] = centre;
  // R_y columns: X → (c, 0, −s), Y → (0, 1, 0), Z → (s, 0, c).
  const tx = -(cs * cx + sn * cz);
  const ty = -cy;
  const tz = -(-sn * cx + cs * cz);
  return [
    scale * cs,
    0,
    -scale * sn,
    0,
    0,
    scale,
    0,
    0,
    scale * sn,
    0,
    scale * cs,
    0,
    scale * tx,
    scale * ty,
    scale * tz,
    1,
  ];
}
