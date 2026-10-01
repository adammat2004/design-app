import type { Point } from '../../geometry/primitives.js';
import { fromDisplay, toDisplay, type Unit } from '../units.js';

/**
 * Snapping to round numbers: the grid step a point lands on, the decimetre a dragged side tidies to,
 * and the bearing a dragged rotation settles at.
 *
 * Moved here from the web app so the three editors, and later the generator and the planner, share
 * one answer to "what is a tidy number" — the web's `lib/grid.ts` re-exports every name, so nothing
 * that imported them had to change.
 */

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

/**
 * The step a resize snaps its sides to, in display units.
 *
 * Finer than `SNAP_STEP` on purpose. A resize is about the shape's centre, so a side snapped to half
 * a metre moves each edge a quarter at a time and a 3.2 m terrace becomes unreachable; a decimetre is
 * what a garden is actually measured to, and it still tidies a dragged 3.1847 m into 3.2.
 */
export const SIZE_SNAP_STEP = 0.1;

export function snapLength(metres: number, unit: Unit): number {
  const display = toDisplay(metres, unit);
  /* Divided rather than multiplied back, so 3.2 comes out as 3.2 and not 3.2000000000000006. */
  const perUnit = Math.round(1 / SIZE_SNAP_STEP);
  return fromDisplay(Math.round(display * perUnit) / perUnit, unit);
}

/** Degrees a snapped rotation steps in. */
export const ROTATION_SNAP_STEP = 15;
/** Within this many degrees of a reference bearing, a rotation snaps to it rather than to the step. */
export const ROTATION_SNAP_REACH = 4;

/**
 * A rotation snapped to the nearest bearing worth having.
 *
 * `references` are bearings the plan already has — the house's, a wall's — each good at every
 * quarter turn, because a patio square to a house turned 23° is at 23°, 113°, 203° or 293°. They win
 * when within `ROTATION_SNAP_REACH`, since lining up with the building is nearly always what a person
 * dragging a rotate handle means; otherwise the angle lands on a 15° step. Returned in [0, 360).
 */
export function snapRotation(degrees: number, references: number[] = []): number {
  const normalise = (angle: number) => ((angle % 360) + 360) % 360;
  const angle = normalise(degrees);

  let best: { value: number; distance: number } | null = null;
  for (const reference of references) {
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const candidate = normalise(reference + quarter * 90);
      const raw = Math.abs(candidate - angle);
      const distance = Math.min(raw, 360 - raw);
      if (distance <= ROTATION_SNAP_REACH && (!best || distance < best.distance)) {
        best = { value: candidate, distance };
      }
    }
  }
  if (best) return best.value;

  return normalise(Math.round(angle / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP);
}
