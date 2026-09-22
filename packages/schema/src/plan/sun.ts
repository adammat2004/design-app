import { getPosition } from 'suncalc';
import type { Point } from '../geometry/primitives.js';
import type { SiteSection, SiteSun } from './site.js';

/**
 * Where the sun is, and which way that makes shadows fall.
 *
 * In the shared package rather than the renderer for the same reason heights are: a shadow is a
 * claim about the garden, not about how it is drawn, and the placer that will one day put seating
 * in afternoon sun runs on the server and cannot import the web renderer.
 *
 * The ephemeris itself is `suncalc` — 300 lines, no dependencies, built on Meeus' *Astronomical
 * Algorithms*. Writing our own would be a week of work and a permanent source of quiet wrongness
 * in a number nobody would think to check.
 *
 * **Conventions line up exactly, which is not luck — it is why suncalc was chosen.** It returns
 * azimuth in degrees clockwise from north (0 = N, 90 = E, 180 = S, 270 = W), which is the same
 * frame `site.orientation` is already expressed in. Note this is a suncalc *2.x* fact: 1.x
 * returned radians measured from south, so a snippet found online may be 180 degrees and a unit
 * conversion away from correct.
 */

export interface SolarPosition {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees above the horizon. Negative when the sun has set. */
  altitude: number;
}

export interface ShadowCast {
  /**
   * Unit vector in plan space — metres, +y downwards, the same frame every outline is in.
   * Points the way shadows fall, which is directly away from the sun.
   */
  direction: Point;
  /** Multiply by an object's height to get its shadow's length in metres. */
  lengthPerMetre: number;
  /**
   * Where this cast came from, and it is the field that keeps the solar claim honest.
   *
   * `'solar'` is a real sun computed from a stated location and time. `'conventional'` is the
   * drawing convention a renderer may supply instead — shadows falling away from the same
   * top-left light that bevels every slab, at a fixed ratio — so that a plan which has never said
   * where on Earth it is still reads as a drawing rather than a diagram.
   *
   * The distinction is not cosmetic and nothing may blur it. Anything that would be *a claim about
   * this garden at this hour* — the time-of-day slider, the shadow-hours sheet, the night ramp and
   * every lighting decision — stays gated on `'solar'`. Only the picture's own sense of depth is
   * allowed to run on the conventional one, exactly as the contact shadow under a sprite and the
   * shade band along a fence already do without a location.
   *
   * This is the sense in which the rule "no location, no solar claim" is unchanged: what was
   * missing was not a sun but a shadow, and a shadow drawn from the drawing's own light says
   * nothing about the sun at all.
   */
  source: 'solar' | 'conventional';
}

/**
 * The reference year every calculation is pinned to.
 *
 * Fixed rather than "this year", and that matters more than it looks: the raster cache keys on
 * the sun, so a year rolling over would silently invalidate every cached surface and quietly
 * change a stored plan's drawing on 1 January. A leap year so that day 366 is a real date.
 *
 * The cost is nil. Solar declination for a given day number varies by a fraction of a degree
 * across the leap cycle, which is far below anything visible in a shadow on a garden plan.
 */
const REFERENCE_YEAR = 2024;

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
/** Degrees of longitude the earth turns through in an hour. */
const DEGREES_PER_HOUR = 15;

/**
 * Longest shadow we will draw, as a multiple of the object's height.
 *
 * A drawing cap, not a physical claim. At 1 degree of altitude the true ratio is 57, so a 6 m
 * tree casts a 344 m shadow — on a 40 m plot that is "the whole garden is in shade", which is
 * both true and exactly what a capped shadow also renders, at a fraction of the geometry. The
 * uncapped version would have the projection and clip doing real work to produce an identical
 * picture.
 */
export const MAX_SHADOW_RATIO = 50;

/**
 * The instant to compute for, as a real `Date`.
 *
 * `minutes` is read as **local mean solar time at the site**, and converted to UTC using the
 * longitude. That is deliberate on two counts. It is deterministic — the same document produces
 * the same sun on a laptop in Manchester and a CI runner in Virginia, where reading the field as
 * the machine's local time would not. And it is the physically meaningful reading: solar time is
 * a function of longitude, so "15:00" means mid-afternoon *where the garden is* without needing a
 * timezone database to say so.
 */
export function sunInstant(sun: SiteSun, longitude: number): Date {
  const utcMinutes = sun.minutes - (longitude / DEGREES_PER_HOUR) * MINUTES_PER_HOUR;

  // Day 1 is 1 January, so day N is (N - 1) days after the year's start.
  const startOfYear = Date.UTC(REFERENCE_YEAR, 0, 1);

  return new Date(
    startOfYear + (sun.dayOfYear - 1) * 1440 * MS_PER_MINUTE + utcMinutes * MS_PER_MINUTE,
  );
}

/**
 * Where the sun is for this plan, or `null` if the plan has never said where it is.
 *
 * `null` rather than a plausible default, which is the whole point: without a location there is
 * no honest answer, and inventing one would have the design built confidently around a fact the
 * user never stated. Callers fall back to the conventional top-left drawing light and make no
 * claim about sun or shade.
 */
export function solarPosition(site: SiteSection): SolarPosition | null {
  const { location, sun } = site;
  if (!location) return null;

  return getPosition(sunInstant(sun, location.longitude), location.latitude, location.longitude);
}

/**
 * Which way shadows fall and how long they are, in the plan's own coordinate frame.
 *
 * `null` when there is no location, and also when the sun is at or below the horizon — at night
 * there is no direct sun, and drawing a shadow anyway would be inventing one. A caller that gets
 * `null` draws no cast shadows at all rather than falling back to a made-up direction.
 */
export function shadowCast(site: SiteSection): ShadowCast | null {
  const position = solarPosition(site);
  if (!position || position.altitude <= 0) return null;

  /*
   * A shadow falls directly away from the sun, so its bearing is the sun's plus half a turn.
   * `orientation` then rotates the whole compass into screen space: it is degrees clockwise from
   * screen-up to true north, so a bearing measured from north sits at `orientation + bearing`
   * clockwise from up.
   */
  const screenAngle = toRadians(site.orientation + position.azimuth + 180);

  return {
    // +y is downwards, so screen-up is -y. A bearing of 0 with no rotation points straight up.
    direction: { x: Math.sin(screenAngle), y: -Math.cos(screenAngle) },
    lengthPerMetre: Math.min(1 / Math.tan(toRadians(position.altitude)), MAX_SHADOW_RATIO),
    source: 'solar',
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * A unit vector pointing **towards** the sun, in the plan's own frame.
 *
 * The opposite of `shadowCast.direction`, which points the way shadows fall. Both come from one
 * solar position, which is the whole point: a drawing reads as a render rather than a diagram
 * largely because everything in it agrees about where the light is. Slab bevels lit from the
 * top-left while a tree's shadow stretches south-east is two suns in one picture, and it is the
 * single most obvious way a rendering gives itself away.
 *
 * `null` for the same two reasons `shadowCast` is: no location, or the sun is down. Callers fall
 * back to the conventional drawing light, which is what the plan has always used.
 */
export function lightDirection(site: SiteSection): Point | null {
  const cast = shadowCast(site);
  if (!cast) return null;

  return { x: -cast.direction.x, y: -cast.direction.y };
}

/**
 * The altitude at which the sky is fully dark for drawing purposes: the end of civil twilight.
 *
 * A real threshold rather than a chosen one. Civil twilight is the standard definition of the
 * point at which outdoor activity needs artificial light, which is precisely the question a
 * lighting layer is asking.
 */
export const CIVIL_TWILIGHT_DEGREES = -6;

/**
 * How dark it is: 0 in daylight, 1 once civil twilight has ended, ramping between.
 *
 * `null` with no location, and that is the same refusal `shadowCast` and `lightDirection` make —
 * without a latitude there is no such thing as sunset here, and a plan that dimmed itself on a
 * guess would be making exactly the claim `site.location` is nullable to avoid. A caller that gets
 * `null` draws no lighting at all and keeps the conventional drawing light.
 *
 * A **ramp** rather than a boolean, because the alternative is visibly wrong: switching the whole
 * garden from noon to midnight in one step of a slider whose step is fifteen minutes reads as a
 * bug, and dusk is the hour a lit garden actually looks its best. Between the two thresholds this
 * is the honest in-between state — the sun is down, the sky is not yet dark, and the fittings are
 * on.
 */
export function nightFraction(site: SiteSection): number | null {
  const position = solarPosition(site);
  if (!position) return null;
  if (position.altitude >= 0) return 0;
  if (position.altitude <= CIVIL_TWILIGHT_DEGREES) return 1;

  return position.altitude / CIVIL_TWILIGHT_DEGREES;
}
