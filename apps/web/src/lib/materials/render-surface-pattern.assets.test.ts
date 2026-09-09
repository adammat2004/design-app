import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { MaterialId, Point } from '@garden-studio/schema';
import { nodeAssetLoader } from './assets/node-loader';
import {
  getAssetVariants,
  preloadAssets,
  resetAssetRegistryForTests,
  type AssetLookup,
} from './assets/registry';
import { materialAssets } from './assets/material-assets';
import { resolvePattern, type MaterialManifestEntry } from './palette';
import {
  drawSurfacePattern,
  type MakeCanvas,
  type PatternCanvas,
  type PatternContext,
} from './render-surface-pattern';

/**
 * The painter with real images loaded.
 *
 * The rules from `render-surface-pattern.test.ts` still apply — the shipped palette is never
 * thresholded — and one more joins them: **a textured or sprite pass is not byte-stable across a
 * re-clip**, because resampling a photograph at a fractional position shifts channel values even
 * far inside. Structural assertions therefore compare *with* and *without* assets, or check the
 * high-contrast joint fixture, and equality is asked of the same input drawn twice.
 *
 * Every test skips itself when the family it needs has not been generated, so the suite is green
 * on a checkout with no assets — a marker's checkout.
 */

const PUBLIC_ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
const ORIGIN: Point = { x: 0, y: 0 };

const rectangle: Point[] = [
  { x: 1, y: 1 },
  { x: 7, y: 1 },
  { x: 7, y: 5 },
  { x: 1, y: 5 },
];

beforeAll(async () => {
  resetAssetRegistryForTests();
  await preloadAssets(nodeAssetLoader(PUBLIC_ASSETS));
});

function have(id: MaterialId, what: 'face' | 'texture' | 'sprites'): boolean {
  const wanted = materialAssets(id);
  if (!wanted) return false;
  if (what === 'sprites') return (wanted.sprites ?? []).some((s) => getAssetVariants(s).length > 0);
  const family = wanted[what];
  return family !== undefined && getAssetVariants(family).length > 0;
}

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

interface Options {
  material?: MaterialManifestEntry;
  /** Absent leaves every tint off, which is the pre-asset drawing path. */
  tint?: boolean;
  assets?: AssetLookup;
  pxPerMetre?: number;
  seed?: string;
  size?: { width: number; height: number };
}

function render(outlines: Point[][], options: Options = {}) {
  const pxPerMetre = options.pxPerMetre ?? 32;
  const size = options.size ?? { width: 8 * pxPerMetre, height: 6 * pxPerMetre };
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  const material = options.material ?? resolvePattern('stone-pavers')!;

  outlines.forEach((outline, index) => {
    drawSurfacePattern(
      context as unknown as PatternContext,
      outline,
      material,
      { origin: ORIGIN, rotation: 0 },
      `${options.seed ?? 'surface'}-${index}`,
      { pxPerMetre, assets: options.assets, makeCanvas: options.tint ? makeCanvas : undefined },
      ORIGIN,
    );
  });

  return {
    pixels: context.getImageData(0, 0, size.width, size.height).data,
    width: size.width,
    at(x: number, y: number) {
      const i = (Math.round(y * pxPerMetre) * size.width + Math.round(x * pxPerMetre)) * 4;
      return Array.from(context.getImageData(0, 0, size.width, size.height).data.slice(i, i + 4));
    },
  };
}

function differ(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count += 1;
  }
  return count;
}

describe('a mass texture stacked on itself', () => {
  /*
   * Surfaces of one material genuinely overlap: `computeZones` gives a garden one base lawn per
   * zone, and an accent lawn is drawn over one of them — a measured quarter of the suburban
   * fixture's lawn is covered twice.
   *
   * While the palette was washed over the *finished surface* rather than baked into the tile, that
   * second draw multiplied the tint again and the overlap showed as a hard-edged block of darker
   * green across one continuous lawn. Tinting the tile makes the tile opaque, so the second draw
   * writes the pixels the first one did. This is the test that stops it coming back.
   */
  it('is invisible where two lawns of the same turf overlap', () => {
    if (!have('hardwearing-turf', 'texture')) return;

    const material = resolvePattern('hardwearing-turf')!;
    const options = { material, assets: getAssetVariants, tint: true };

    const once = render([rectangle], options);
    const twice = render([rectangle, rectangle], options);

    expect(differ(once.pixels, twice.pixels)).toBe(0);
  });

  /* And the tint has to be doing something, or the test above passes for the wrong reason. */
  it('carries the palette into the photograph', () => {
    if (!have('hardwearing-turf', 'texture')) return;

    const material = resolvePattern('hardwearing-turf')!;
    const plain = render([rectangle], { material, assets: getAssetVariants });
    const tinted = render([rectangle], { material, assets: getAssetVariants, tint: true });

    expect(differ(plain.pixels, tinted.pixels)).toBeGreaterThan(0);
  });
});

describe('with assets loaded', () => {
  it('draws the same pixels twice', () => {
    const a = render([rectangle], { assets: getAssetVariants });
    const b = render([rectangle], { assets: getAssetVariants });
    expect(Buffer.from(a.pixels)).toEqual(Buffer.from(b.pixels));
  });

  it('changes a slab surface when faces are present, and leaves the joints where they were', () => {
    if (!have('stone-pavers', 'face')) return;

    const shipped = resolvePattern('stone-pavers')!;
    const fixture: MaterialManifestEntry = {
      ...shipped,
      pattern: { patternType: 'grid', moduleSize: { w: 600, h: 600 }, jointWidth: 100 },
      palette: ['#ffffff'],
      jointColour: '#000000',
    };

    const flat = render([rectangle], { material: fixture, pxPerMetre: 40 });
    const faced = render([rectangle], {
      material: fixture,
      pxPerMetre: 40,
      assets: getAssetVariants,
    });

    // Something inside a module changed: the photograph is there.
    expect(differ(flat.pixels, faced.pixels)).toBeGreaterThan(0);

    // The joint at x = 0.7 m (pitch 0.7: module 0.6 + joint 0.1, joint centred on the pitch line)
    // is still black in both. Faces never move the grid.
    const jointX = 0.7 * 3 + 0.05 - 0.05;
    expect(faced.at(jointX, 3)).toEqual(flat.at(jointX, 3));
    expect(faced.at(jointX, 3).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('tiles a mass texture continuously across a shared edge', () => {
    if (!have('decorative-gravel', 'texture')) return;
    const material = resolvePattern('decorative-gravel')!;

    const left: Point[] = [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 5 },
      { x: 1, y: 5 },
    ];
    const right: Point[] = [
      { x: 4, y: 1 },
      { x: 7, y: 1 },
      { x: 7, y: 5 },
      { x: 4, y: 5 },
    ];

    const split = render([left, right], { material, assets: getAssetVariants });
    const whole = render([rectangle], { material, assets: getAssetVariants });

    // Well inside either half the tiles are the same tiles; the cut edge differs by design, so the
    // comparison stays a slab's width away from x = 4 and from the outline.
    for (const [x, y] of [
      [2, 3],
      [3, 2],
      [5, 3],
      [6, 4],
    ] as const) {
      const a = split.at(x, y);
      const b = whole.at(x, y);
      for (let c = 0; c < 3; c += 1) expect(Math.abs(a[c]! - b[c]!)).toBeLessThanOrEqual(3);
    }
  });

  it('keeps drawing planting units on a bed whose sprites have not arrived', () => {
    if (!have('shrubs', 'texture')) return;
    const material = resolvePattern('shrubs')!;

    // A lookup that has the soil but not the plants: the state a slow network leaves a bed in.
    const soilOnly: AssetLookup = (id) => (id.startsWith('plant-') ? [] : getAssetVariants(id));

    const bed = render([rectangle], { material, assets: soilOnly });

    /*
     * Counted against the soil rather than against a near-empty bed.
     *
     * This used to build its comparison by overriding the material's `density` to nearly zero. That
     * stopped meaning anything when a planting bed became a *stack*: `resolveLayers` replaces the
     * material's own pattern with the scheme's layers, so editing the material's density changes
     * nothing and the two renders came out identical — the test failing not because plants had
     * stopped being drawn but because its lever had been disconnected.
     *
     * Asserting on the pixels directly is both simpler and harder to disconnect: the soil is brown,
     * the blob fallback is drawn from the material's greens, so a bed with plants on it has green
     * pixels and a bed of bare soil does not.
     */
    let green = 0;
    for (let i = 0; i < bed.pixels.length; i += 4) {
      const r = bed.pixels[i]!;
      const g = bed.pixels[i + 1]!;
      const b = bed.pixels[i + 2]!;
      if (bed.pixels[i + 3]! > 0 && g > r + 8 && g > b + 8) green += 1;
    }

    expect(green).toBeGreaterThan(500);
  });

  it('draws sprites when they are there, and a different picture from the blobs', () => {
    if (!have('shrubs', 'sprites')) return;
    const material = resolvePattern('shrubs')!;

    const withSprites = render([rectangle], { material, assets: getAssetVariants });
    const withoutAssets = render([rectangle], { material });

    expect(differ(withSprites.pixels, withoutAssets.pixels)).toBeGreaterThan(100);
  });

  it('draws nothing different when the lookup answers empty', () => {
    const empty: AssetLookup = () => [];
    const a = render([rectangle], { assets: empty });
    const b = render([rectangle]);
    expect(Buffer.from(a.pixels)).toEqual(Buffer.from(b.pixels));
  });
});
