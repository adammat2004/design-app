import { describe, expect, it } from 'vitest';
import { SiteSectionSchema, type SiteSection } from './site.js';
import { lightDirection, MAX_SHADOW_RATIO, shadowCast, solarPosition, sunInstant } from './sun.js';

/**
 * These assert *physics*, not whatever the library happens to return.
 *
 * A test that pins suncalc's output to numbers copied out of a first run proves only that the
 * code still calls the same function. The facts below are true independently of the library —
 * the sun is due south at northern solar noon, due north at southern solar noon, and its noon
 * altitude on the solstice is `90 - latitude + 23.44`. If the azimuth convention is ever wrong by
 * 180 degrees, or a hemisphere sign flips, these fail and a pinned-output test would not.
 */

/** Manchester. Far enough north that a hemisphere error is unmissable. */
const MANCHESTER = { latitude: 53.4, longitude: -2.98 };
/** Sydney, for the same reason in the other direction. */
const SYDNEY = { latitude: -33.87, longitude: 151.21 };

/** 20 June 2024 — the solstice. */
const SOLSTICE = 172;
const SOLAR_NOON = 720;
const AXIAL_TILT = 23.44;

/**
 * How far off due south the sun may be at *mean* solar noon, in degrees.
 *
 * `minutes` is mean solar time, and the sun does not cross the meridian at mean noon — the
 * equation of time swings apparent noon by up to about 16 minutes either way over the year,
 * which is 4 degrees of rotation. Asserting exactly 180 would be asserting that the Earth's
 * orbit is circular and its axis untilted. Two degrees comfortably covers the solstice, where
 * the equation of time is small.
 */
const EQUATION_OF_TIME_DEGREES = 2;

/** The same slack expressed as a unit-vector component: `sin(2 degrees)`, rounded up. */
const OFF_AXIS = 0.04;

function siteAt(
  location: { latitude: number; longitude: number } | null,
  sun: { dayOfYear: number; minutes: number } = { dayOfYear: SOLSTICE, minutes: SOLAR_NOON },
  orientation = 0,
): SiteSection {
  return SiteSectionSchema.parse({ location, sun, orientation });
}

describe('solarPosition', () => {
  it('is null on a plan that has never said where it is', () => {
    expect(solarPosition(siteAt(null))).toBeNull();
  });

  it('puts the midsummer noon sun due south in the northern hemisphere', () => {
    const position = solarPosition(siteAt(MANCHESTER))!;

    expect(Math.abs(position.azimuth - 180)).toBeLessThan(EQUATION_OF_TIME_DEGREES);
  });

  it('puts the midwinter noon sun due north in the southern hemisphere', () => {
    // June is Sydney's winter, and the noon sun is in the north. This is the assertion that
    // catches a hemisphere sign error, which a UK-only test cannot see.
    const position = solarPosition(siteAt(SYDNEY))!;
    const fromNorth = Math.min(position.azimuth, 360 - position.azimuth);

    expect(fromNorth).toBeLessThan(EQUATION_OF_TIME_DEGREES);
  });

  it('gets the solstice noon altitude right, which is 90 - latitude + tilt', () => {
    // Pure geometry, true of any latitude, and independent of any library.
    const north = solarPosition(siteAt(MANCHESTER))!;
    expect(north.altitude).toBeCloseTo(90 - MANCHESTER.latitude + AXIAL_TILT, 0);

    // Southern winter: the tilt subtracts instead of adding.
    const south = solarPosition(siteAt(SYDNEY))!;
    expect(south.altitude).toBeCloseTo(90 - Math.abs(SYDNEY.latitude) - AXIAL_TILT, 0);
  });

  it('reads minutes as local solar time, so longitude moves the UTC instant', () => {
    // The determinism property. Nothing here depends on the machine's timezone: the same
    // document has to produce the same sun on a laptop in Manchester and a CI runner in Virginia.
    const greenwich = sunInstant({ dayOfYear: SOLSTICE, minutes: SOLAR_NOON }, 0);
    expect(greenwich.toISOString()).toBe('2024-06-20T12:00:00.000Z');

    // 15 degrees east is one hour ahead of UTC, so local noon there is 11:00 UTC.
    const east = sunInstant({ dayOfYear: SOLSTICE, minutes: SOLAR_NOON }, 15);
    expect(east.toISOString()).toBe('2024-06-20T11:00:00.000Z');
  });

  it('pins the year, so a plan does not redraw itself on 1 January', () => {
    // The raster cache keys on the sun. A floating "this year" would invalidate every cached
    // surface at midnight on New Year's Eve and quietly change a stored plan's drawing.
    expect(sunInstant({ dayOfYear: 1, minutes: 0 }, 0).getUTCFullYear()).toBe(2024);
    expect(sunInstant({ dayOfYear: 366, minutes: 0 }, 0).getUTCFullYear()).toBe(2024);
  });
});

describe('shadowCast', () => {
  it('is null without a location, so nothing claims to know where the shade is', () => {
    expect(shadowCast(siteAt(null))).toBeNull();
  });

  it('is null at night, rather than inventing a direction', () => {
    // Midnight local solar time. The sun is below the horizon and there is no direct shadow.
    expect(shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: 0 }))).toBeNull();
  });

  it('sends the northern noon shadow straight up a north-up plan', () => {
    // Sun due south, so the shadow falls due north. With orientation 0 the screen is north-up
    // and +y is downwards, so "north" is (0, -1).
    const cast = shadowCast(siteAt(MANCHESTER))!;

    expect(Math.abs(cast.direction.x)).toBeLessThan(OFF_AXIS);
    expect(cast.direction.y).toBeCloseTo(-1, 2);
  });

  it('sends the southern noon shadow straight down the same plan', () => {
    // The inversion. Sun due north, shadow due south, which is (0, +1) on screen.
    const cast = shadowCast(siteAt(SYDNEY))!;

    expect(Math.abs(cast.direction.x)).toBeLessThan(OFF_AXIS);
    expect(cast.direction.y).toBeCloseTo(1, 2);
  });

  it('rotates with the plot, because orientation is what puts north on the screen', () => {
    // Orientation 90 means true north points to the right of the screen. The same northward
    // noon shadow must therefore point right, not up.
    const cast = shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: SOLAR_NOON }, 90))!;

    expect(cast.direction.x).toBeCloseTo(1, 2);
    expect(Math.abs(cast.direction.y)).toBeLessThan(OFF_AXIS);
  });

  it('always returns a unit direction, whatever the hour', () => {
    for (const minutes of [420, 600, 720, 900, 1140]) {
      const cast = shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes }));
      if (!cast) continue;

      const length = Math.hypot(cast.direction.x, cast.direction.y);
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('makes shadows longer as the sun gets lower', () => {
    const noon = shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: SOLAR_NOON }))!;
    const evening = shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: 1140 }))!;

    expect(evening.lengthPerMetre).toBeGreaterThan(noon.lengthPerMetre);
  });

  it('caps the ratio, so a low sun cannot ask for a kilometre of geometry', () => {
    // Just above the horizon the true ratio runs to 57 and beyond. The cap is a drawing
    // convention: on any real plot a capped shadow and an uncapped one both mean "all in shade".
    const lowSun = shadowCast(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: 1290 }));

    if (lowSun) expect(lowSun.lengthPerMetre).toBeLessThanOrEqual(MAX_SHADOW_RATIO);
  });

  it('is exactly one metre of shadow per metre of height at 45 degrees', () => {
    // Somewhere on the day the sun passes 45 degrees; find it and check the identity holds.
    const atFortyFive = [...Array(1440).keys()]
      .map((minutes) => ({
        minutes,
        position: solarPosition(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes })),
      }))
      .find(({ position }) => position && Math.abs(position.altitude - 45) < 0.05);

    expect(atFortyFive).toBeDefined();

    const cast = shadowCast(
      siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: atFortyFive!.minutes }),
    )!;
    expect(cast.lengthPerMetre).toBeCloseTo(1, 1);
  });
});

describe('lightDirection', () => {
  it('is exactly opposite the way shadows fall', () => {
    // One solar position, two derived vectors. If these ever drift apart the drawing has two
    // suns: slabs lit from one side while the shadows stretch away from another.
    const site = siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: 960 });

    const light = lightDirection(site)!;
    const cast = shadowCast(site)!;

    expect(light.x).toBeCloseTo(-cast.direction.x, 10);
    expect(light.y).toBeCloseTo(-cast.direction.y, 10);
  });

  it('points south at northern noon, which is down a north-up plan', () => {
    // The sun is due south; +y is downwards, so "towards the sun" is (0, +1).
    const light = lightDirection(siteAt(MANCHESTER))!;

    expect(Math.abs(light.x)).toBeLessThan(OFF_AXIS);
    expect(light.y).toBeCloseTo(1, 2);
  });

  it('is null without a location, so the drawing keeps its conventional light', () => {
    expect(lightDirection(siteAt(null))).toBeNull();
  });

  it('is null at night rather than lighting the plan from below the horizon', () => {
    expect(lightDirection(siteAt(MANCHESTER, { dayOfYear: SOLSTICE, minutes: 0 }))).toBeNull();
  });
});
