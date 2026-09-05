import type { AssetImage, AssetLoader } from './registry';

/** Where the files are served from. Same origin, so no CORS and no `crossOrigin` attribute. */
export const ASSET_BASE_URL = '/assets/';

/**
 * Loads one asset in the browser.
 *
 * `decode()` rather than `onload`, so the image is ready to be drawn the moment the promise
 * resolves — an image that has loaded but not decoded costs its first `drawImage` a synchronous
 * decode inside the raster pass, which is exactly the frame the cache exists to keep smooth.
 */
export const loadBrowserAsset: AssetLoader = async (file: string): Promise<AssetImage> => {
  const image = new Image();
  image.src = `${ASSET_BASE_URL}${file}`;
  await image.decode();
  return image;
};
