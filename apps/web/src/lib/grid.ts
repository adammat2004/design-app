import type { Point } from '@garden-studio/schema';
import { fromDisplay, toDisplay, type Unit } from './units';

/**
 * The canvas is graph paper, so the grid, the scale bar and snapping all have to agree on
 * what a sensible step is. That answer lives here once.
 *
 * Steps are expressed in *display* units — a grid drawn in metres while the user is reading
 * feet would be worse than no grid at all.
 */

const STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

/** The largest step from the ladder that still fits inside `maxPx` at this zoom. */
export function niceStep(scale: number, unit: Unit, maxPx: number): number {
  const fits = (step: number) => fromDisplay(step, unit) * scale <= maxPx;
  return [...STEPS].reverse().find(fits) ?? STEPS[0];
}

/**
 * Minor lines are the boxes you measure against; every fifth is drawn heavier so the eye can
 * count them without losing its place.
 */
export function gridSteps(scale: number, unit: Unit): { minor: number; major: number } {
  // Aim for boxes of roughly 28px, small enough to measure with but not a moiré pattern.
  const minor = niceStep(scale, unit, 40);
  return { minor, major: minor * 5 };
}

/**
 * How much ground fits across the viewport, in metres.
 *
 * This replaces a zoom percentage, which is not a meaningful reading on a plan: "100%" meant
 * `DEFAULT_SCALE` — 32 pixels per metre — and nothing else. Not the fit, not device pixels, and
 * not any real-world ratio, so a user comparing two plans at "100%" was comparing nothing.
 *
 * A printed drawing states a ratio instead (1:100), and that was the obvious alternative. It is
 * rejected because a ratio is only true if the display's *physical* size is known, which in a
 * browser it is not — a 1:100 label would be wrong on every monitor but one. Metres across the
 * viewport needs no calibration, is exactly true, and is the reading a non-technical user can
 * check against a garden they have actually stood in.
 */
export function viewportSpan(stageWidth: number, scale: number): number {
  return scale > 0 ? stageWidth / scale : 0;
}

/** The span as a label. Coarse on purpose — it is orientation, not a measurement. */
export function formatViewportSpan(metres: number, unit: Unit): string {
  const value = toDisplay(metres, unit);
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;

  return `${rounded} ${unit} across`;
}

/**
 * Snapping is deliberately *not* tied to the grid. The grid changes as you zoom, and a snap
 * step that shifted under the user mid-drag would be maddening; half a unit is fine enough
 * that a measured 12.6 m is still reachable and coarse enough to tidy a hand-drawn plot.
 */
export const SNAP_STEP = 0.5;

export function snapToStep(metres: number, unit: Unit): number {
  const display = toDisplay(metres, unit);
  return fromDisplay(Math.round(display / SNAP_STEP) * SNAP_STEP, unit);
}

export function snapPoint(point: Point, unit: Unit): Point {
  return { x: snapToStep(point.x, unit), y: snapToStep(point.y, unit) };
}
