import type { SiteLocation } from '@garden-studio/schema';

/**
 * Slippy-map arithmetic: where a latitude and longitude land in the Web Mercator tile grid.
 *
 * This is the projection the tiles are *drawn* in and nothing else. The plan never measures in
 * it — see `local-frame.ts` for why — so the only questions this module answers are "which tile
 * covers this point at this zoom" and "which zoom has tiles about the size the screen wants".
 *
 * Conventions are the de-facto XYZ ones every provider shares: tile (0, 0) is the north-west
 * corner of the world, `x` runs east, `y` runs south, and zoom `z` has `2^z` tiles a side. WMTS
 * services with a Web Mercator matrix set use the same numbers.
 */

/** The sphere Web Mercator is defined on. Not the ellipsoid, and not used for any distance. */
export const MERCATOR_RADIUS = 6_378_137;
/** Mercator's usable latitude limit; beyond it `y` runs off to infinity. */
const MAX_LATITUDE = 85.051_128_78;

const DEGREES = Math.PI / 180;

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

/** Fractional tile coordinates: the integer part is the tile, the fraction is where inside it. */
export function latLngToTileFraction(
  location: SiteLocation,
  zoom: number,
): { x: number; y: number } {
  const tiles = 2 ** zoom;
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, location.latitude));
  const sin = Math.sin(latitude * DEGREES);

  return {
    x: ((location.longitude + 180) / 360) * tiles,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * tiles,
  };
}

/** The latitude and longitude of a fractional tile coordinate — the inverse of the above. */
export function tileFractionToLatLng(x: number, y: number, zoom: number): SiteLocation {
  const tiles = 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / tiles;

  return {
    latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    longitude: (x / tiles) * 360 - 180,
  };
}

/** The tile containing a point. */
export function tileAt(location: SiteLocation, zoom: number): TileCoordinate {
  const fraction = latLngToTileFraction(location, zoom);
  return { z: zoom, x: Math.floor(fraction.x), y: Math.floor(fraction.y) };
}

/** The north-west and south-east corners of a tile. */
export function tileBounds(tile: TileCoordinate): { northWest: SiteLocation; southEast: SiteLocation } {
  return {
    northWest: tileFractionToLatLng(tile.x, tile.y, tile.z),
    southEast: tileFractionToLatLng(tile.x + 1, tile.y + 1, tile.z),
  };
}

/**
 * How many screen pixels one *true* metre of ground gets from a tile at this zoom and latitude,
 * if the tile is drawn at its native size.
 *
 * A tile spans `2πR / 2^z` Mercator metres, and at latitude φ a Mercator metre is `cos φ` true
 * metres — so the ground a tile covers shrinks towards the poles while its pixel count does not.
 */
export function nativePixelsPerMetre(zoom: number, latitude: number, tileSize: number): number {
  const mercatorMetresPerTile = (2 * Math.PI * MERCATOR_RADIUS) / 2 ** zoom;
  const groundMetresPerTile = mercatorMetresPerTile * Math.cos(latitude * DEGREES);
  return tileSize / groundMetresPerTile;
}

/**
 * The zoom whose tiles are nearest to native size for a canvas drawn at `scale` pixels per metre.
 *
 * Rounded rather than ceiled: a tile drawn at up to √2 of its size is not visibly softer, and
 * rounding halves the requests a zoom gesture makes. Clamped to the provider's range, so above
 * `maxZoom` the same tiles are simply drawn larger — the honest picture, since no sharper one
 * exists.
 */
export function tileZoomFor(
  scale: number,
  latitude: number,
  options: { minZoom: number; maxZoom: number; tileSize: number },
): number {
  const { minZoom, maxZoom, tileSize } = options;
  const ideal = Math.log2(scale / nativePixelsPerMetre(0, latitude, tileSize));
  return Math.max(minZoom, Math.min(maxZoom, Math.round(ideal)));
}
