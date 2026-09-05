import type { AssetId } from './asset-spec';
import {
  CATALOGUE_VERSION,
  catalogueEntries,
  catalogueEntry,
  type CatalogueEntry,
} from './catalogue';

/**
 * The loaded images, reachable synchronously.
 *
 * The painter is a pure function that runs inside a raster pass; it cannot await. So images are
 * loaded once, up front, into a module-level map, and the painter asks for them with a plain
 * lookup that answers `null` until they are there. Null is the ordinary answer during the first
 * frames and the permanent one when a file failed to load — and in both cases the painter draws
 * what it drew before assets existed. Nothing here can make a surface disappear.
 *
 * Versioned, so the raster cache can tell a surface drawn without its texture from one drawn
 * with it. `assetVersion()` is `'none'` until the preload settles and the catalogue's hash after,
 * which puts exactly one redraw between the two states — the same argument that put `light` in
 * the cache key.
 *
 * The image type is structural, for the reason `PatternCanvas` is: the browser hands in an
 * `HTMLImageElement`, the tests hand in `@napi-rs/canvas`'s `Image`, and both are something a 2D
 * context will `drawImage`.
 */
export interface AssetImage {
  width: number;
  height: number;
}

export type AssetLoader = (file: string) => Promise<AssetImage>;

/** What the painter is handed: every loaded variant of a family, in order. */
export type AssetLookup = (id: AssetId) => LoadedAsset[];

export interface LoadedAsset {
  image: AssetImage;
  entry: CatalogueEntry;
}

const loaded = new Map<string, LoadedAsset>();
const listeners = new Set<() => void>();

let version = 'none';
let preload: Promise<void> | null = null;

function key(id: AssetId, variant: number): string {
  return `${id}-${variant}`;
}

/** One variant of a family, if it has loaded. */
export function getAsset(id: AssetId, variant: number): LoadedAsset | null {
  return loaded.get(key(id, variant)) ?? null;
}

/** Every loaded variant of a family, in variant order. Empty until the preload has delivered. */
export function getAssetVariants(id: AssetId): LoadedAsset[] {
  const out: LoadedAsset[] = [];
  for (let variant = 1; ; variant += 1) {
    const asset = loaded.get(key(id, variant));
    if (!asset) break;
    out.push(asset);
  }
  return out;
}

export function assetVersion(): string {
  return version;
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The version reported once the first wave has landed but the rest is still coming.
 *
 * It has to differ from both `'none'` and `CATALOGUE_VERSION`, because `assetVersion()` is in the
 * raster cache key and a wave that did not change it would leave every surface holding the raster
 * it drew before its texture arrived — the "plan textures in patches" failure the version exists to
 * prevent, arriving one wave later instead of not at all.
 */
export const FIRST_WAVE_VERSION = `${CATALOGUE_VERSION}-w1`;

/**
 * Loads the catalogued files. Idempotent: the second caller gets the first caller's promise.
 *
 * All settled, never all-or-nothing. One missing file should cost one texture, not the lot.
 *
 * ## Waves
 *
 * `first` names the assets this plan actually draws with. Given, they are loaded and published
 * before anything else starts, and the rest follows in the background.
 *
 * At forty-three assets loading everything at once was free. At the several hundred this library is
 * heading for it is a large first paint spent mostly on textures the open plan does not use — a
 * garden with no water does not need four water tiles, and a plan with no play area does not need a
 * trampoline. Two waves gets the visible plan textured quickly and costs exactly one extra redraw,
 * which is the same trade the version already makes between `'none'` and loaded.
 *
 * Deliberately **not** lazy-per-asset. A texture that arrives while the user is looking at the
 * surface it belongs to is a visible pop; a wave that arrives while they are still reading the
 * plan is not, and the difference is that a wave is predictable.
 */
export function preloadAssets(loader: AssetLoader, first?: readonly AssetId[]): Promise<void> {
  if (preload) return preload;

  preload = (async () => {
    const entries = catalogueEntries();

    const wanted = first === undefined ? null : new Set<string>(first);
    const load = async (entry: CatalogueEntry) => {
      const image = await loader(entry.file);
      loaded.set(key(entry.id, entry.variant), { image, entry });
    };

    if (wanted && wanted.size > 0) {
      const wave = entries.filter((entry) => wanted.has(entry.id));
      const rest = entries.filter((entry) => !wanted.has(entry.id));

      await Promise.allSettled(wave.map(load));
      version = FIRST_WAVE_VERSION;
      for (const listener of listeners) listener();

      await Promise.allSettled(rest.map(load));
    } else {
      await Promise.allSettled(entries.map(load));
    }

    version = CATALOGUE_VERSION;
    for (const listener of listeners) listener();
  })();

  return preload;
}

/** Whether a family has at least one variant catalogued — before or after loading. */
export function hasCataloguedVariant(id: AssetId): boolean {
  return catalogueEntry(id, 1) !== null;
}

/* ---------------------------------------------------------------- test seams */

export function resetAssetRegistryForTests(): void {
  loaded.clear();
  listeners.clear();
  version = 'none';
  preload = null;
}
