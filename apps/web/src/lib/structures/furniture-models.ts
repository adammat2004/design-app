import { useSyncExternalStore } from 'react';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FURNITURE_MANIFEST, type FurnitureModelEntry } from './furniture/manifest';
import { absentResource, createResource, type Resource } from './resource';

/**
 * The furniture models, loaded on demand and never suspended on.
 *
 * One `Resource` per model key, shared by every piece that uses it. What arrives is the model's one
 * mesh as plain float geometry in its own frame — base-centred, front +Z, metres — ready for
 * `fitToFootprint` to place and the furniture material to dress: the GLB is quantised
 * (`KHR_mesh_quantization`), which stores its dequantising scale on the node, so the node's transform
 * is baked in and the attributes widened to floats here, once.
 *
 * The meshopt decoder is three's own copy, bundled — never fetched — so a model loads offline. A key
 * with no model in the manifest, or a file that fails to load, is `null`, and the piece draws as the
 * boxes it always did.
 */
export type FurnitureModel = { entry: FurnitureModelEntry; geometry: BufferGeometry };

const models = new Map<string, Resource<FurnitureModel>>();
const listeners = new Set<() => void>();
let settled = 0;

export function furnitureModel(symbol: string | undefined): Resource<FurnitureModel> {
  const key = symbol ?? '';
  let resource = models.get(key);
  if (resource) return resource;
  const entry = FURNITURE_MANIFEST.models[key];
  resource = entry ? createResource(() => loadModel(entry)) : absentResource<FurnitureModel>();
  resource.subscribe(() => {
    settled += 1;
    for (const listener of listeners) listener();
  });
  models.set(key, resource);
  return resource;
}

async function loadModel(entry: FurnitureModelEntry): Promise<FurnitureModel> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`/${entry.file}`);
  gltf.scene.updateMatrixWorld(true);
  let found: Mesh | null = null;
  gltf.scene.traverse((object) => {
    if (!found && object instanceof Mesh) found = object;
  });
  if (!found) throw new Error(`${entry.file} has no mesh`);
  const mesh = found as Mesh;
  const geometry = widened(mesh.geometry);
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { entry, geometry };
}

/** The geometry with every attribute as plain floats, so a transform can be baked into it. */
function widened(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes) as [
    string,
    BufferAttribute | InterleavedBufferAttribute,
  ][]) {
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i += 1) {
      for (let k = 0; k < attribute.itemSize; k += 1) {
        values[i * attribute.itemSize + k] = attribute.getComponent(i, k);
      }
    }
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  return geometry;
}

/** How the models have loaded, over every model something has asked for. */
export type ModelsStatus = 'none' | 'loading' | 'ready' | 'partial' | 'failed';

export function modelsStatus(): ModelsStatus {
  const asked = [...models.entries()].filter(([key]) => key in FURNITURE_MANIFEST.models);
  if (asked.length === 0) return 'none';
  const states = asked.map(([, resource]) => resource.status());
  if (states.some((state) => state === 'loading' || state === 'idle')) return 'loading';
  if (states.every((state) => state === 'ready')) return 'ready';
  if (states.every((state) => state === 'failed')) return 'failed';
  return 'partial';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useModelsStatus(): ModelsStatus {
  return useSyncExternalStore(subscribe, modelsStatus, () => 'none');
}

/** Bumps each time a model settles. */
export function useModelsSettled(): number {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => 0,
  );
}
