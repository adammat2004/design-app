import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_VERSION, catalogueEntries } from './catalogue';
import {
  assetVersion,
  getAsset,
  getAssetVariants,
  preloadAssets,
  resetAssetRegistryForTests,
  subscribeAssets,
  type AssetLoader,
} from './registry';

/**
 * The registry is the seam between "the files exist" and "the painter can draw them", and its
 * contract is small: nothing before the preload, everything that loaded after it, one version flip
 * in between. A fake loader stands in for the browser and for disk alike.
 */

const entries = catalogueEntries();
const first = entries[0];

const fakeLoader: AssetLoader = async (file) => ({ width: 10, height: 10, file }) as never;

beforeEach(() => {
  resetAssetRegistryForTests();
});

describe('assetRegistry', () => {
  it('answers null and "none" before anything has loaded', () => {
    if (!first) return;
    expect(getAsset(first.id, first.variant)).toBeNull();
    expect(getAssetVariants(first.id)).toEqual([]);
    expect(assetVersion()).toBe('none');
  });

  it('holds every catalogued file after the preload, and flips the version once', async () => {
    if (!first) return;
    const listener = vi.fn();
    subscribeAssets(listener);

    await preloadAssets(fakeLoader);

    expect(getAsset(first.id, first.variant)?.entry).toEqual(first);
    expect(getAssetVariants(first.id).length).toBeGreaterThan(0);
    expect(assetVersion()).toBe(CATALOGUE_VERSION);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second preload is the first one', async () => {
    const loader = vi.fn(fakeLoader);
    const a = preloadAssets(loader);
    const b = preloadAssets(loader);
    expect(a).toBe(b);
    await a;
    expect(loader).toHaveBeenCalledTimes(entries.length);
  });

  it('loses one file when one file fails, not the lot', async () => {
    if (entries.length < 2) return;
    const victim = entries[0]!;
    const loader: AssetLoader = async (file) => {
      if (file === victim.file) throw new Error('404');
      return fakeLoader(file);
    };

    await preloadAssets(loader);

    expect(getAsset(victim.id, victim.variant)).toBeNull();
    const survivor = entries.find((entry) => entry.file !== victim.file)!;
    expect(getAsset(survivor.id, survivor.variant)).not.toBeNull();
    expect(assetVersion()).toBe(CATALOGUE_VERSION);
  });

  it('lists variants in order and stops at the first gap', async () => {
    const family = entries.find((entry) => entry.variant === 1);
    if (!family) return;
    await preloadAssets(fakeLoader);

    const variants = getAssetVariants(family.id);
    variants.forEach((asset, index) => expect(asset.entry.variant).toBe(index + 1));
  });
});
