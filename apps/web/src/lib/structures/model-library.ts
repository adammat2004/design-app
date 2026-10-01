import { useSyncExternalStore } from 'react';
import { Box3, Mesh, Vector3, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  EMPTY_MODEL_LIBRARY,
  libraryEntry,
  ModelLibrarySchema,
  type ModelLibrary,
  type ModelLibraryEntry,
} from '@garden-studio/ar-contract';
import { createResource, useResource, type Resource } from './resource';

/**
 * The model library, as the web draws it: `library.json` and the GLBs beside it under
 * `public/models/library/`, written by `models:publish` (see "Library models from Meshy").
 *
 * Both load on demand and are never suspended on, the rule `resource.ts` exists for. Until the
 * manifest has arrived the scene is built with no library, so every structure draws its own parts;
 * when it arrives the scene is rebuilt with it and a matched structure carries an `AssetRef`; until
 * that model's file has arrived — or for good, if it 404s — the parts still draw. A missing library
 * is the state a fresh clone with the files deleted is in, and the garden is complete in it.
 *
 * Unlike the furniture models (`furniture-models.ts`), which keep one mesh and re-skin it in the
 * finish the user chose, **a library model keeps its own meshes and its own PBR materials**: what it
 * depicts was matched exactly (`matchLibraryAsset`), so its baked colour is the colour the plan says.
 */

const LIBRARY_URL = '/models/library/library.json';

export const MODEL_LIBRARY: Resource<ModelLibrary> = createResource(async () => {
  const response = await fetch(LIBRARY_URL);
  if (!response.ok) throw new Error(`${LIBRARY_URL}: ${response.status}`);
  return ModelLibrarySchema.parse(await response.json());
});

/** The library once it has loaded, or `null` — which the builder treats as no library at all. */
export function useModelLibrary(): ModelLibrary | null {
  return useResource(MODEL_LIBRARY);
}

/** A model's scene, in the entry's promised frame: metres, +Y up, base-centred, front +Z. */
export interface LibraryModel {
  entry: ModelLibraryEntry;
  scene: Group;
  /** The loaded file's own size, measured, for checking the entry's promise. */
  measured: [number, number, number];
}

const models = new Map<string, Resource<LibraryModel>>();
const listeners = new Set<() => void>();
let settled = 0;

/** One resource per id, shared by every structure drawn with it. */
export function libraryModel(id: string): Resource<LibraryModel> {
  let resource = models.get(id);
  if (resource) return resource;
  resource = createResource(async () => {
    const library = (await MODEL_LIBRARY.start()) ?? EMPTY_MODEL_LIBRARY;
    const entry = libraryEntry(library, id);
    if (!entry) throw new Error(`${id} is not in the model library`);
    return loadModel(entry);
  });
  resource.subscribe(() => {
    settled += 1;
    for (const listener of listeners) listener();
  });
  models.set(id, resource);
  return resource;
}

async function loadModel(entry: ModelLibraryEntry): Promise<LibraryModel> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`/${entry.file}`);
  const scene = gltf.scene;
  // The materials are the file's own PBR — double-sided, as Meshy writes them, which is right for a
  // roof plane one face thick seen from under the eaves.
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  scene.updateMatrixWorld(true);
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  return { entry, scene, measured: [size.x, size.y, size.z] };
}

/** How the library models asked for so far have loaded, for the viewports' test hooks. */
export type LibraryModelsStatus = 'none' | 'loading' | 'ready' | 'partial' | 'failed';

export function libraryModelsStatus(): LibraryModelsStatus {
  const states = [...models.values()].map((resource) => resource.status());
  if (states.length === 0) return 'none';
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

export function useLibraryModelsStatus(): LibraryModelsStatus {
  return useSyncExternalStore(subscribe, libraryModelsStatus, () => 'none');
}

/** Bumps each time a library model settles, so a `frameloop="demand"` canvas can redraw. */
export function useLibraryModelsSettled(): number {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => 0,
  );
}
