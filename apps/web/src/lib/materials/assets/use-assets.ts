'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AssetId } from './asset-spec';
import { loadBrowserAsset } from './browser-loader';
import { assetVersion, preloadAssets, subscribeAssets } from './registry';

/**
 * The React edge of the asset registry.
 *
 * `useAssetVersion` re-renders its caller once, when the preload settles, which is what carries a
 * new version into every raster's cache key at the same moment. `useAssetPreload` starts the load;
 * it is idempotent, so every canvas calls it and the first one to mount wins.
 */
export function useAssetVersion(): string {
  return useSyncExternalStore(subscribeAssets, assetVersion, () => 'none');
}

/**
 * Starts the load, newest-plan-first.
 *
 * `first` names the families this plan draws with, so they land before the rest of the library.
 * Read once, on mount, and deliberately not reactive: the wave is an ordering hint, not a
 * subscription, and re-running it as the user edits would restart nothing (the preload is
 * idempotent) while making the dependency list a lie.
 */
export function useAssetPreload(first?: readonly AssetId[]): void {
  const firstRef = useRef(first);

  useEffect(() => {
    void preloadAssets(loadBrowserAsset, firstRef.current);
  }, []);
}
