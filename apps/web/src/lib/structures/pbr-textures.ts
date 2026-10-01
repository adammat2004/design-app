import { useSyncExternalStore } from 'react';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { PBR_CATALOGUE, type PbrSetEntry } from './pbr/catalogue';
import { absentResource, createResource, type Resource } from './resource';

/**
 * The 3D library's material sets, loaded on demand and never suspended on.
 *
 * A set is three textures — albedo (absent for a detail-only set), normal and ORM — wrapped and
 * repeated once per `tileSizeM`, because every mesh that takes one carries texture coordinates in
 * metres (`partGeometry`, `extrudedGeometry`, a floor's `uv1`). One `Resource` per set, shared by
 * every material that uses it; a material asks for its set and upgrades itself when it arrives
 * (`materials-3d.ts`), so the view draws flat first and never waits.
 *
 * A key the catalogue does not know is an absent resource: nothing is fetched, the material stays
 * flat, and the library can be deleted outright without the view noticing anything but the grain.
 */
export type PbrSet = {
  entry: PbrSetEntry;
  albedo: Texture | null;
  normal: Texture;
  orm: Texture;
};

const sets = new Map<string, Resource<PbrSet>>();
const listeners = new Set<() => void>();
let settled = 0;

export function pbrSet(key: string): Resource<PbrSet> {
  let resource = sets.get(key);
  if (resource) return resource;
  const entry = PBR_CATALOGUE.sets[key];
  resource = entry ? createResource(() => loadSet(entry)) : absentResource<PbrSet>();
  resource.subscribe(() => {
    settled += 1;
    for (const listener of listeners) listener();
  });
  sets.set(key, resource);
  return resource;
}

async function loadSet(entry: PbrSetEntry): Promise<PbrSet> {
  const loader = new TextureLoader();
  const load = async (file: string, colour: boolean) => {
    const texture = await loader.loadAsync(`/assets/${file}`);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / entry.tileSizeM, 1 / entry.tileSizeM);
    texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const [albedo, normal, orm] = await Promise.all([
    entry.files.albedo ? load(entry.files.albedo.file, true) : Promise.resolve(null),
    load(entry.files.normal.file, false),
    load(entry.files.orm.file, false),
  ]);
  return { entry, albedo, normal, orm };
}

/**
 * How the library has loaded, over every set something has asked for: `none` until anything asks,
 * `loading` while any is in flight, then `ready`, `failed`, or `partial` for a mix.
 */
export type PbrStatus = 'none' | 'loading' | 'ready' | 'partial' | 'failed';

export function pbrStatus(): PbrStatus {
  if (sets.size === 0) return 'none';
  const states = [...sets.values()].map((resource) => resource.status());
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

/** Bumps each time any set settles: what the viewport redraws on, under a demand frame loop. */
export function usePbrSettled(): number {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => 0,
  );
}

export function usePbrStatus(): PbrStatus {
  return useSyncExternalStore(subscribe, pbrStatus, () => 'none');
}

/** A texture read through a mesh's second UV set, `uv1` — how a floor takes detail under its raster. */
const onSecondChannel = new WeakMap<Texture, Texture>();

export function secondChannel(texture: Texture): Texture {
  let clone = onSecondChannel.get(texture);
  if (!clone) {
    clone = texture.clone();
    clone.channel = 1;
    clone.needsUpdate = true;
    onSecondChannel.set(texture, clone);
  }
  return clone;
}
