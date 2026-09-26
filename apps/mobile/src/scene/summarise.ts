import type { ARCategory, ARNode, ARScene } from '@garden-studio/ar-contract';

export interface SceneFacts {
  /** Width and depth of the whole scene on the ground, in metres. */
  footprint: { width: number; depth: number };
  nodes: Record<ARNode['kind'], number>;
  categories: Partial<Record<ARCategory, number>>;
  plantInstances: number;
  triangles: number;
  hiddenByDefault: number;
}

/**
 * What a scene contains, counted. Shown on the scene screen, and the first numbers to watch when
 * performance work starts: triangles and plant instances are what a phone pays for.
 */
export function summarise(scene: ARScene): SceneFacts {
  const nodes: SceneFacts['nodes'] = { surface: 0, solid: 0, model: 0, plants: 0 };
  const categories: SceneFacts['categories'] = {};
  let plantInstances = 0;
  let triangles = 0;
  let hiddenByDefault = 0;
  for (const node of scene.nodes) {
    nodes[node.kind] += 1;
    categories[node.category] = (categories[node.category] ?? 0) + 1;
    if (!node.visibleByDefault) hiddenByDefault += 1;
    if (node.kind === 'surface') triangles += node.mesh.indices.length / 3;
    if (node.kind === 'solid') {
      for (const part of node.parts) triangles += part.mesh.indices.length / 3;
    }
    if (node.kind === 'plants') plantInstances += node.instances.length;
  }
  const [minX, , minZ] = scene.bounds.min;
  const [maxX, , maxZ] = scene.bounds.max;
  return {
    footprint: { width: maxX - minX, depth: maxZ - minZ },
    nodes,
    categories,
    plantInstances,
    triangles,
    hiddenByDefault,
  };
}
