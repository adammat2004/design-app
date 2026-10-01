import { rotateAboutY, type ARScene, type Mesh, type ModelNode, type Vec3 } from '@garden-studio/ar-contract';
import type { LocalFrame, LocalPoint } from '@garden-studio/schema';
import { BufferAttribute, BufferGeometry } from 'three';

/**
 * The pure half of the whole-garden preview: what it counts, where its cameras stand, and the
 * geometry it hands to three.js. Everything here reads the `ARScene` and nothing else — the preview
 * never reaches back into the plan, which is what makes it a check on the scene the phone will draw
 * rather than a second drawing of the garden.
 */

export interface PreviewCounts {
  surfaces: number;
  solids: number;
  models: number;
  /** Plant *instances*, not nodes: what a budget is counted in. */
  plants: number;
  /** Nodes a library model may draw (an `AssetRef`), whatever kind they are. */
  assets: number;
}

export function previewCounts(scene: ARScene): PreviewCounts {
  const counts: PreviewCounts = { surfaces: 0, solids: 0, models: 0, plants: 0, assets: 0 };
  for (const node of scene.nodes) {
    if ((node.kind === 'solid' || node.kind === 'model') && node.asset) counts.assets += 1;
    if (node.kind === 'surface') counts.surfaces += 1;
    else if (node.kind === 'solid') counts.solids += 1;
    else if (node.kind === 'model') counts.models += 1;
    else counts.plants += node.instances.length;
  }
  return counts;
}

/** Eye height for standing at the garden door. */
export const EYE_HEIGHT = 1.6;

export type PreviewView = 'door' | 'overview';

export interface CameraView {
  position: Vec3;
  target: Vec3;
}

/**
 * Where each camera stands.
 *
 * - **From the door**: in the doorway at eye height, a metre back inside the house, looking out and
 *   a little down — the view the whole design is laid out for, and the one a garden owner knows.
 *   Standing *out* on the threshold was the first answer and it missed the terrace: the things laid
 *   across the doors sit round the camera rather than in front of it, and a view that shows the far
 *   border and not the table outside the door is not the view from the door. From inside, the
 *   house's walls face away from the camera and are culled, so the doorway simply frames the garden.
 * - **Overview**: above the far end of the garden, looking back at the house — the whole design
 *   with the house behind it. From behind the house, which was tried first, the building (a block
 *   with no roof yet) stood between the camera and most of the garden.
 *
 * With no house, from the middle of the plot looking up the page.
 */
export function cameraView(scene: ARScene, view: PreviewView): CameraView {
  const [ox, oz] = scene.frame.houseOutward ?? [0, -1];
  const { min, max } = scene.bounds;
  if (view === 'door') {
    return {
      position: [-ox * DOOR_SETBACK, EYE_HEIGHT, -oz * DOOR_SETBACK],
      target: [ox * 12, -0.5, oz * 12],
    };
  }
  const centre: Vec3 = [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2];
  const span = Math.hypot(max[0] - min[0], max[2] - min[2]);
  const back = span * 0.5 + 4;
  return {
    position: [centre[0] + ox * back, span * 0.5 + 4, centre[2] + oz * back],
    target: centre,
  };
}

/** How far back inside the doorway the door view stands, in metres. */
export const DOOR_SETBACK = 1;

/** The preview's field of view: wide enough from the doorway to take in the terrace either side. */
export const PREVIEW_FOV = 60;

/** How far from the scene origin anything reaches: what the sun's shadow camera has to cover. */
export function sceneReach(scene: ARScene): number {
  const { min, max } = scene.bounds;
  return Math.max(4, ...[min[0], max[0]].flatMap((x) => [min[2], max[2]].map((z) => Math.hypot(x, z))));
}

/**
 * A model's footprint on the ground, as the four corners the furniture fit reads — in
 * `rectangleOutline`'s order (front-left, front-right, back-right, back-left before the turn), so
 * `fitToFootprint` finds the front where the plan put it.
 */
export function modelRing(node: ModelNode): LocalPoint[] {
  const [x, , z] = node.position;
  const [width, , depth] = node.size;
  const corners: [number, number][] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  return corners.map((corner) => {
    const [dx, dz] = rotateAboutY(corner, node.yaw);
    return { x: x + dx, z: z + dz };
  });
}

/**
 * The scene frame as a `LocalFrame`: a translation to the origin and no turn, so the sun helper the
 * structure editor uses (`sunInFrame`) gives the plan's own sun in scene coordinates.
 */
export function sceneFrameOf(scene: ARScene): LocalFrame {
  const { x: ox, y: oy } = scene.frame.origin.plan;
  return {
    rotation: 0,
    toLocal: (point) => ({ x: point.x - ox, z: point.y - oy }),
    toPlan: (point) => ({ x: point.x + ox, y: point.z + oy }),
  };
}

/** A contract mesh as a three.js geometry: the arrays are already in the layout WebGL uploads. */
export function meshGeometry(mesh: Mesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(mesh.uvs), 2));
  geometry.setIndex(mesh.indices);
  geometry.computeBoundingSphere();
  return geometry;
}
