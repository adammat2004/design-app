import { describe, expect, it } from 'vitest';
import type { CanvasTransform } from '@/lib/canvas-transform';
import { localFrame } from './local-frame';
import { MAX_VISIBLE_TILES, parentTile, placeTile, tileKey, visibleTiles } from './tiles';

const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };

/** A 900 × 600 stage with the anchor in the middle at the default 32 px/m. */
const transform: CanvasTransform = {
  scale: 32,
  offsetX: 450,
  offsetY: 300,
  stageWidth: 900,
  stageHeight: 600,
};

describe('visibleTiles', () => {
  const frame = localFrame(DUBLIN);

  it('covers the whole stage with tiles that meet edge to edge', () => {
    const tiles = visibleTiles(transform, frame, 19);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES);

    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.width))).toBeGreaterThanOrEqual(900);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.top + t.height))).toBeGreaterThanOrEqual(600);

    // Neighbours abut to within a hundredth of a pixel: the axis-aligned placement is exact
    // across a plot-sized view, and a visible seam would be the first sign it was not.
    for (const placed of tiles) {
      const right = tiles.find(
        (other) => other.tile.y === placed.tile.y && other.tile.x === placed.tile.x + 1,
      );
      if (right) expect(Math.abs(right.left - (placed.left + placed.width))).toBeLessThan(0.01);

      const below = tiles.find(
        (other) => other.tile.x === placed.tile.x && other.tile.y === placed.tile.y + 1,
      );
      if (below) expect(Math.abs(below.top - (placed.top + placed.height))).toBeLessThan(0.01);
    }
  });

  it('places the tile under the anchor across the stage centre, slightly wider than tall', () => {
    const tiles = visibleTiles(transform, frame, 19);
    const underAnchor = tiles.find(
      (t) => t.left <= 450 && t.left + t.width >= 450 && t.top <= 300 && t.top + t.height >= 300,
    );
    expect(underAnchor).toBeDefined();
    // A zoom-19 tile is ~45.7 m of ground, which is ~1,463 px at 32 px/m.
    expect(underAnchor!.width).toBeCloseTo(1463, -1);
    // Web Mercator is spherical and the frame is ellipsoidal, so a tile that is square in
    // Mercator metres is M/N ≈ 0.9976 as tall as it is wide on the ground at 53°N. Real, and
    // invisible; pinned so a future "fix" that squares the tile is recognised as one.
    expect(underAnchor!.height / underAnchor!.width).toBeCloseTo(0.9976, 3);
  });

  it('is empty for a stage with no size', () => {
    expect(visibleTiles({ ...transform, stageWidth: 0 }, frame, 19)).toEqual([]);
  });

  it('refuses an absurd number of tiles rather than requesting them', () => {
    // At 0.001 px/m a 900 px stage is 900 km across; at zoom 19 that is millions of tiles.
    expect(visibleTiles({ ...transform, scale: 0.001 }, frame, 19)).toEqual([]);
  });

  it('agrees with placeTile for every tile it returns', () => {
    for (const placed of visibleTiles(transform, frame, 18)) {
      expect(placeTile(placed.tile, frame, transform)).toEqual(placed);
    }
  });
});

describe('parentTile', () => {
  it('halves the coordinates', () => {
    expect(parentTile({ z: 19, x: 253_027, y: 169_923 })).toEqual({ z: 18, x: 126_513, y: 84_961 });
    expect(parentTile({ z: 0, x: 0, y: 0 })).toBeNull();
  });

  it('keys tiles by z/x/y', () => {
    expect(tileKey({ z: 3, x: 4, y: 5 })).toBe('3/4/5');
  });
});
