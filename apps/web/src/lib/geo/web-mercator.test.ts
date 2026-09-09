import { describe, expect, it } from 'vitest';
import {
  latLngToTileFraction,
  nativePixelsPerMetre,
  tileAt,
  tileBounds,
  tileFractionToLatLng,
  tileZoomFor,
} from './web-mercator';

const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };

describe('tile arithmetic', () => {
  it('puts the origin of the world at the centre of zoom 1', () => {
    expect(latLngToTileFraction({ latitude: 0, longitude: 0 }, 1)).toEqual({ x: 1, y: 1 });
  });

  it('finds Dublin in the expected zoom-15 tile', () => {
    // x = (173.7397 / 360) · 2^15 = 15814.17; y from the Mercator latitude formula = 10621.11
    // (checked independently against the OSM wiki's slippy-map formula).
    expect(tileAt(DUBLIN, 15)).toEqual({ z: 15, x: 15814, y: 10621 });
  });

  it('round-trips a fractional tile coordinate', () => {
    const fraction = latLngToTileFraction(DUBLIN, 18);
    const back = tileFractionToLatLng(fraction.x, fraction.y, 18);
    expect(back.latitude).toBeCloseTo(DUBLIN.latitude, 9);
    expect(back.longitude).toBeCloseTo(DUBLIN.longitude, 9);
  });

  it('gives a tile bounds that run north-west to south-east', () => {
    const { northWest, southEast } = tileBounds(tileAt(DUBLIN, 15));
    expect(northWest.latitude).toBeGreaterThan(southEast.latitude);
    expect(northWest.longitude).toBeLessThan(southEast.longitude);
    expect(northWest.latitude).toBeGreaterThanOrEqual(DUBLIN.latitude);
    expect(southEast.latitude).toBeLessThanOrEqual(DUBLIN.latitude);
  });
});

describe('nativePixelsPerMetre', () => {
  it('is about 5.6 px/m for a 256 px tile at zoom 19 in Dublin', () => {
    // A zoom-19 tile spans 76.4 Mercator metres, which is 45.7 m of ground at cos 53.3°.
    expect(nativePixelsPerMetre(19, 53.3, 256)).toBeCloseTo(5.6, 1);
  });

  it('doubles per zoom level and per tile size', () => {
    expect(nativePixelsPerMetre(20, 53.3, 256) / nativePixelsPerMetre(19, 53.3, 256)).toBeCloseTo(2, 9);
    expect(nativePixelsPerMetre(19, 53.3, 512) / nativePixelsPerMetre(19, 53.3, 256)).toBeCloseTo(2, 9);
  });
});

describe('tileZoomFor', () => {
  const provider = { minZoom: 0, maxZoom: 19, tileSize: 256 };

  it('clamps to the provider ceiling at the default editing scale', () => {
    expect(tileZoomFor(32, 53.3, provider)).toBe(19);
  });

  it('wants zoom 19 even at the minimum canvas scale', () => {
    // MIN_SCALE is 4 px/m: the provider's *minimum* zoom is never the binding limit on a plan.
    expect(tileZoomFor(4, 53.3, provider)).toBe(19);
  });

  it('rounds to the nearest zoom when the provider allows it', () => {
    expect(tileZoomFor(15, 53.3, { ...provider, maxZoom: 21 })).toBe(20);
  });

  it('never goes below minZoom', () => {
    expect(tileZoomFor(1e-7, 0, { minZoom: 3, maxZoom: 19, tileSize: 256 })).toBe(3);
  });
});
