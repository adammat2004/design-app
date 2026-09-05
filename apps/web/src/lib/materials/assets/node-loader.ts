import { join } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import type { AssetImage, AssetLoader } from './registry';

/**
 * Loads assets from disk, for the preview scripts and the tests.
 *
 * Dev-only: it imports `@napi-rs/canvas`, which is a devDependency and must never be reached from
 * app code. It lives beside the browser loader because the two are the same seam, and a reader
 * looking for "how do assets get loaded in Node" should find it next to the other answer.
 */
export function nodeAssetLoader(publicAssetsDir: string): AssetLoader {
  return async (file: string): Promise<AssetImage> => loadImage(join(publicAssetsDir, file));
}
