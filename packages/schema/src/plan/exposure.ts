import { pointInPolygon, polygonCentroid, type Point } from '../geometry/primitives.js';
import { boundaryRuns } from './boundary-styles.js';
import { elementOutline, type DesignElement } from './concepts.js';
import { projectShadow, shadowOccluders, shadowRings, type ShadowOccluder } from './shadows.js';
import type { SiteSection } from './site.js';
import { shadowCast } from './sun.js';
import type { SunNeed } from './plants/species.js';

/**
 * How many hours of direct sun a spot gets — the one question every planting choice turns on, and
 * the one the plan could not answer: it could draw a shadow at an hour, never say how much of a day
 * a bed spends in one.
 *
 * Sampled every half hour through two representative days — midsummer and the spring equinox —
 * against the same occluders and the same projection the shadow layer draws, so "this bed gets two
 * hours" and the shadow on screen cannot disagree. The answer is the mean of the two days, which is
 * roughly the growing season's; a single day would call a north-facing border sunny in June.
 *
 * **`null` without `site.location`**, like every solar claim in this codebase: there is no latitude
 * that is true of anywhere, and a guessed one would put shade-lovers in the sun.
 */

/** Days of the year sampled: midsummer and the spring equinox. */
export const EXPOSURE_DAYS = [172, 80];
/** Minutes between samples. */
export const EXPOSURE_STEP = 30;

export function sunHours(site: SiteSection, point: Point, occluders: ShadowOccluder[]): number | null {
  if (!site.location) return null;

  let total = 0;
  for (const dayOfYear of EXPOSURE_DAYS) {
    let minutes = 0;
    for (let at = 0; at < 24 * 60; at += EXPOSURE_STEP) {
      const cast = shadowCast({ ...site, sun: { dayOfYear, minutes: at } });
      if (!cast) continue;
      if (!inShadow(point, occluders, cast)) minutes += EXPOSURE_STEP;
    }
    total += minutes / 60;
  }
  return total / EXPOSURE_DAYS.length;
}

function inShadow(point: Point, occluders: ShadowOccluder[], cast: NonNullable<ReturnType<typeof shadowCast>>): boolean {
  for (const occluder of occluders) {
    const geometry = projectShadow(occluder.outline, occluder.height, cast);
    if (!geometry) continue;
    if (shadowRings(geometry).some((ring) => pointInPolygon(point, ring))) return true;
  }
  return false;
}

/**
 * The RHS's bands: full sun is six hours or more of direct sun, partial shade three to six, shade
 * under three. The same words the catalogue's `sun` is written in, so a species and a spot can be
 * compared directly.
 */
export function sunClass(hours: number): SunNeed {
  if (hours >= 6) return 'full';
  if (hours >= 3) return 'part';
  return 'shade';
}

/**
 * The light a whole bed gets: its sample points' hours averaged, then banded. `null` without a
 * location. Points are the caller's — the centroid and a few interior points is plenty for a bed.
 */
export function areaExposure(
  site: SiteSection,
  points: Point[],
  occluders: ShadowOccluder[],
): { hours: number; light: SunNeed } | null {
  if (!site.location || points.length === 0) return null;
  const hours = points.map((point) => sunHours(site, point, occluders) ?? 0);
  const mean = hours.reduce((sum, value) => sum + value, 0) / hours.length;
  return { hours: mean, light: sunClass(mean) };
}

/**
 * The light a bed gets, from everything on the plan that could shade it: the house, the boundary
 * and every other element tall enough to cast. Sampled at the bed's centroid and four points half
 * way from it to the corners, keeping only those actually inside, so a curved or L-shaped bed is
 * not judged by a point in the lawn beside it.
 *
 * The bed itself is left out: planting does not shade the planting it is part of.
 */
export function bedExposure(
  site: SiteSection,
  bed: DesignElement,
  elements: DesignElement[],
): { hours: number; light: SunNeed } | null {
  if (!site.location) return null;
  const outline = elementOutline(bed);
  if (outline.length < 3) return null;
  const centre = polygonCentroid(outline);
  const corners = [0, 0.25, 0.5, 0.75].map((fraction) => outline[Math.floor(fraction * outline.length)]!);
  const points = [centre, ...corners.map((corner) => ({ x: (centre.x + corner.x) / 2, y: (centre.y + corner.y) / 2 }))]
    .filter((point) => pointInPolygon(point, outline));
  const occluders = shadowOccluders(
    elements.filter((element) => element.id !== bed.id),
    site.house ?? null,
    boundaryRuns(site),
  );
  return areaExposure(site, points.length > 0 ? points : [centre], occluders);
}
