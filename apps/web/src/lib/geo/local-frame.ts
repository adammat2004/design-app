import type { Point, SiteLocation } from '@garden-studio/schema';

/**
 * The plan's metre frame, pinned to the Earth at one point.
 *
 * Every coordinate in a `SiteSection` is metres in a local planar frame — origin wherever the
 * user started, +x right, +y down. Aerial imagery arrives in latitude and longitude. This module
 * is the only place the two meet: `georeference` says where local (0, 0) is, and the frame here
 * turns a latitude and longitude into metres from that point and back.
 *
 * **A local tangent plane, not a map projection.** Over a garden the Earth is flat to well under
 * a centimetre, so the conversion is a scale on each axis — metres per degree north and metres
 * per degree east at the anchor's latitude — and nothing more. Web Mercator, the projection the
 * tiles are drawn in, is *not* used for measuring anything: its metres are inflated by
 * `1 / cos(latitude)`, which is ×1.67 at Dublin and ×1.61 at London. A garden measured in Mercator
 * metres would be two-thirds bigger than it is, silently — the same class of wrongness as the
 * 113 m plot that prompted the sanity band. There is a test that pins a 10 m fence at 10 m.
 *
 * **WGS84 radii of curvature, not a mean sphere.** A single spherical radius is short by 0.33%
 * east–west at 53°N, which is 65 cm across a 200 m garden — the dominant error in the whole
 * chain, and free to remove. The remaining truncation error (meridian convergence) at the far
 * corner of a 200 m plot is about 8 mm.
 *
 * `orientation` is accepted from the start even though the aerial flow locks it to zero: it is
 * the frame's rotation, and taking it here means a later "square the plan with the house" is a
 * change to one function rather than a hunt for every caller.
 */

/** WGS84 semi-major axis, metres. */
const WGS84_A = 6_378_137;
/** WGS84 first eccentricity squared. */
const WGS84_E2 = 0.006_694_379_990_14;

const DEGREES = Math.PI / 180;

export interface LocalFrame {
  readonly anchor: SiteLocation;
  /** Degrees clockwise from screen-up to true north, as `site.orientation`. */
  readonly orientation: number;
  toLocal(location: SiteLocation): Point;
  toLatLng(point: Point): SiteLocation;
}

/** Metres per degree of latitude and of longitude at this latitude, from the WGS84 ellipsoid. */
export function metresPerDegree(latitude: number): { north: number; east: number } {
  const sin = Math.sin(latitude * DEGREES);
  const denominator = 1 - WGS84_E2 * sin * sin;

  // Meridional radius of curvature (north–south) and prime-vertical radius (east–west).
  const meridional = (WGS84_A * (1 - WGS84_E2)) / Math.pow(denominator, 1.5);
  const primeVertical = WGS84_A / Math.sqrt(denominator);

  return {
    north: meridional * DEGREES,
    east: primeVertical * Math.cos(latitude * DEGREES) * DEGREES,
  };
}

export function localFrame(anchor: SiteLocation, orientation = 0): LocalFrame {
  const scale = metresPerDegree(anchor.latitude);

  // With orientation θ, north on screen points θ degrees clockwise from up. Rotating the
  // east/north offsets by θ (clockwise, in a y-down frame) puts them where the screen shows them.
  const cos = Math.cos(orientation * DEGREES);
  const sin = Math.sin(orientation * DEGREES);

  return {
    anchor,
    orientation,
    toLocal(location) {
      const east = (location.longitude - anchor.longitude) * scale.east;
      // y is down, so north is negative before any rotation.
      const south = -(location.latitude - anchor.latitude) * scale.north;
      return {
        x: east * cos - south * sin,
        y: east * sin + south * cos,
      };
    },
    toLatLng(point) {
      const east = point.x * cos + point.y * sin;
      const south = -point.x * sin + point.y * cos;
      return {
        latitude: anchor.latitude - south / scale.north,
        longitude: anchor.longitude + east / scale.east,
      };
    },
  };
}

/**
 * Great-circle distance in metres, on a mean sphere. Only a reference for the tests — it is
 * deliberately not what the frame uses, so the two can disagree by exactly the ellipsoid.
 */
export function haversineDistance(a: SiteLocation, b: SiteLocation): number {
  const R = 6_371_008.8;
  const dLat = (b.latitude - a.latitude) * DEGREES;
  const dLng = (b.longitude - a.longitude) * DEGREES;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * DEGREES) * Math.cos(b.latitude * DEGREES) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
