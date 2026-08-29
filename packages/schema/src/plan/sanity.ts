import {
  edgeLength,
  polygonArea,
  polygonCentroid,
  polygonEdges,
  scalePointAbout,
  type Point,
} from '../geometry/primitives.js';
import { formatArea, formatLength, type Unit } from './units.js';

/**
 * Does this plot plausibly describe a residential garden?
 *
 * Step 1 asks the user to draw a scaled polygon on a blank grid, and nothing about that gesture
 * carries a scale — so a plot drawn ten times too big looks exactly like a plot drawn correctly.
 * A 113 x 74.5 m "garden" of some 8,400 m² was accepted in silence, and the user had no way to
 * see it: there is no reference object on the canvas and one square of grid looks like any other.
 *
 * This is a **warning, never a refusal**. The wizard autosaves and the whole document layer stores
 * invalid drafts and reports them rather than rejecting the write — a plot outside the band is
 * unusual, not illegal, and a large rural site is a real thing a user might have. What the band
 * buys is that the mistake is *stated*, next to a one-tap fix, instead of surfacing three screens
 * later as a garden the generator could not sensibly fill.
 *
 * Thresholds live here rather than in the web app because a server-side check would want exactly
 * the same numbers, and two copies would be two answers.
 */

/** Metres. Longer than any side of an ordinary residential plot. */
export const MAX_SENSIBLE_EDGE = 60;

/** Square metres. Above this the plot is a paddock rather than a garden. */
export const MAX_SENSIBLE_AREA = 2000;

/** Square metres. Below this there is no garden to design — a small balcony is about 5 m². */
export const MIN_SENSIBLE_AREA = 5;

/**
 * What the one-tap fix divides by.
 *
 * Ten because the error this catches is almost always a decimal-point-shaped one: the user read
 * the grid as ten times finer than it is and drew every side an order of magnitude too long. A
 * plot that is merely large is not helped by any factor, and `scaleDownHelps` says so.
 */
export const SCALE_DOWN_FACTOR = 10;

export type PlotSanityCode = 'area-too-large' | 'edge-too-long' | 'area-too-small';

export interface PlotSanityWarning {
  code: PlotSanityCode;
  /** The measurement that tripped the band, already in the user's unit. */
  headline: string;
  /** One sentence saying why it looks wrong. */
  detail: string;
  /**
   * Whether dividing every coordinate by `SCALE_DOWN_FACTOR` would clear the warning outright.
   * Measured by actually scaling the polygon and re-checking, not assumed — a plot can be far
   * enough out of band that one step does not bring it back, and offering a fix that leaves the
   * warning on screen is worse than offering none.
   */
  scaleDownHelps: boolean;
}

/** The longest side of a closed polygon, including the edge that closes it. */
export function longestEdge(polygon: Point[]): number {
  if (polygon.length < 2) return 0;

  return polygonEdges(polygon).reduce(
    (longest, edge) => Math.max(longest, edgeLength(edge.start, edge.end)),
    0,
  );
}

/** Which band the plot falls outside, largest problem first. */
function sanityCode(polygon: Point[]): PlotSanityCode | null {
  if (polygon.length < 3) return null;

  const area = polygonArea(polygon);
  if (area > MAX_SENSIBLE_AREA) return 'area-too-large';
  if (longestEdge(polygon) > MAX_SENSIBLE_EDGE) return 'edge-too-long';

  // A polygon still being drawn has no area at all; that is not "too small", it is unfinished.
  if (area > 1e-6 && area < MIN_SENSIBLE_AREA) return 'area-too-small';

  return null;
}

/** The plot scaled about its own centroid, so a rescale changes size without moving the plot. */
export function scalePolygonAbout(polygon: Point[], centre: Point, factor: number): Point[] {
  return polygon.map((point) => scalePointAbout(point, centre, factor));
}

/**
 * The warning for a **closed** boundary, or `null` when the plot looks ordinary.
 *
 * Closed because `longestEdge` walks the wrapping edge, which on a half-drawn polygon is the long
 * straight line back to the first corner and would trip the band on almost every plot mid-draw.
 */
export function checkPlotSanity(polygon: Point[], unit: Unit): PlotSanityWarning | null {
  const code = sanityCode(polygon);
  if (!code) return null;

  const centre = polygonCentroid(polygon);
  const scaledDown = scalePolygonAbout(polygon, centre, 1 / SCALE_DOWN_FACTOR);
  const scaleDownHelps = sanityCode(scaledDown) === null;

  switch (code) {
    case 'area-too-large':
      return {
        code,
        headline: `This plot is ${formatArea(polygonArea(polygon), unit)}`,
        detail: `That is larger than ${formatArea(MAX_SENSIBLE_AREA, unit)} — about the size of a small field. Check the side lengths against a real measurement.`,
        scaleDownHelps,
      };

    case 'edge-too-long':
      return {
        code,
        headline: `One side is ${formatLength(longestEdge(polygon), unit)}`,
        detail: `Residential plots are rarely more than ${formatLength(MAX_SENSIBLE_EDGE, unit)} along a side. Check that side against a real measurement.`,
        scaleDownHelps,
      };

    case 'area-too-small':
      return {
        code,
        headline: `This plot is only ${formatArea(polygonArea(polygon), unit)}`,
        detail: `That is smaller than a parking space, so there is very little to design. Check the side lengths against a real measurement.`,
        scaleDownHelps,
      };
  }
}
