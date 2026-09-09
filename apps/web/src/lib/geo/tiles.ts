import type { Point } from '@garden-studio/schema';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';
import type { LocalFrame } from './local-frame';
import { latLngToTileFraction, tileBounds, type TileCoordinate } from './web-mercator';

/**
 * Which tiles cover the stage, and where each one goes.
 *
 * The placement runs each tile's corners through the *same* `toLocal` the geometry uses and the
 * same `metresToPx` every handle uses. That is what makes "the imagery sits under the corners
 * the user clicked" true by construction rather than by a second formula that has to agree with
 * the first. A tile is placed as an axis-aligned rectangle from its north-west and south-east
 * corners: across a plot-sized viewport the difference between Mercator's scale at the top of
 * the screen and at the bottom is well under a pixel (there is a test), and any residual shows
 * up as a hairline at a tile seam rather than as a wrong measurement, because nothing measures
 * off the picture.
 *
 * One consequence worth knowing: a placed tile is not quite square. Web Mercator is defined on
 * a sphere and the frame measures on the ellipsoid, so a tile that is square in Mercator metres
 * is about 0.24% shorter than it is wide on the ground at 53°N. The picture is stretched by that
 * much, which no eye can see; the geometry is not, which is the point.
 */

export interface PlacedTile {
  tile: TileCoordinate;
  /** `z/x/y` — a stable key for the cache and for React. */
  key: string;
  /** Stage pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The ceiling on tiles for one frame. `SquareGrid` guards its line count the same way: an
 * absurd transform must degrade to drawing nothing, never to thousands of image fetches.
 */
export const MAX_VISIBLE_TILES = 256;

export function tileKey(tile: TileCoordinate): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** Stage pixel rect for one tile. Exported for the tests that check seams meet. */
export function placeTile(
  tile: TileCoordinate,
  frame: LocalFrame,
  transform: CanvasTransform,
): PlacedTile {
  const bounds = tileBounds(tile);
  const northWest = metresToPx(frame.toLocal(bounds.northWest), transform);
  const southEast = metresToPx(frame.toLocal(bounds.southEast), transform);

  return {
    tile,
    key: tileKey(tile),
    left: northWest.x,
    top: northWest.y,
    width: southEast.x - northWest.x,
    height: southEast.y - northWest.y,
  };
}

/**
 * Every tile at `zoom` that overlaps the stage, placed. Empty when the stage has no size or the
 * range is implausibly large.
 */
export function visibleTiles(
  transform: CanvasTransform,
  frame: LocalFrame,
  zoom: number,
): PlacedTile[] {
  const { stageWidth, stageHeight } = transform;
  if (stageWidth <= 0 || stageHeight <= 0) return [];

  // The stage's corners, in tile units. Taking all four (not just two) keeps this correct if the
  // frame is ever rotated by `orientation`.
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: stageWidth, y: 0 },
    { x: 0, y: stageHeight },
    { x: stageWidth, y: stageHeight },
  ];
  const fractions = corners.map((corner) =>
    latLngToTileFraction(frame.toLatLng(pxToMetres(corner, transform)), zoom),
  );

  const tiles = 2 ** zoom;
  const minX = Math.max(0, Math.floor(Math.min(...fractions.map((f) => f.x))));
  const maxX = Math.min(tiles - 1, Math.floor(Math.max(...fractions.map((f) => f.x))));
  const minY = Math.max(0, Math.floor(Math.min(...fractions.map((f) => f.y))));
  const maxY = Math.min(tiles - 1, Math.floor(Math.max(...fractions.map((f) => f.y))));

  if (maxX < minX || maxY < minY) return [];
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_VISIBLE_TILES) return [];

  const placed: PlacedTile[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      placed.push(placeTile({ z: zoom, x, y }, frame, transform));
    }
  }
  return placed;
}

/** The tile one zoom out that contains this one — drawn scaled while the sharper one loads. */
export function parentTile(tile: TileCoordinate): TileCoordinate | null {
  if (tile.z === 0) return null;
  return { z: tile.z - 1, x: Math.floor(tile.x / 2), y: Math.floor(tile.y / 2) };
}
