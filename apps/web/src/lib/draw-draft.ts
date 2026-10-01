import { vertexEditIsValid, type PlanGeometry, type Point } from '@garden-studio/schema';

/**
 * Drawing a shape one click at a time, without a store.
 *
 * Step 2 has drawn polygons and paths this way since it existed, with the rules inside its store;
 * step 5 draws them now too, and two editors whose "click near the first corner to close" differed
 * would be two editors to learn. Each store keeps its own draft points and mode and asks this what a
 * click means.
 */

/**
 * How near the first corner a click closes the shape, in metres. One number for the boundary on step
 * 1, a feature on step 2 and a surface on step 5.
 */
export const CLOSE_DISTANCE = 0.6;

export type DraftPlacement = 'polygon' | 'polyline';

export type DraftStep =
  /** Add this point. */
  | { kind: 'add'; point: Point }
  /** Close the shape — the click landed on the first corner. */
  | { kind: 'close' }
  /** Nothing — a repeat of the last point, which is how a double click arrives. */
  | { kind: 'ignore' };

/**
 * What a click at `raw` does to a draft.
 *
 * The close test reads the **raw** pointer, as step 1's boundary does. Snapping first can carry the
 * point further from the first corner than `CLOSE_DISTANCE` — onto a nearby wall, a grid line — so a
 * shape refused to close exactly when the user aimed at its first corner in order to close it. Only
 * a click that does not close is snapped, by the caller's own rule.
 */
export function draftStep(
  points: Point[],
  raw: Point,
  placement: DraftPlacement,
  snap: (raw: Point, points: Point[]) => Point,
): DraftStep {
  const first = points[0];
  if (
    placement === 'polygon' &&
    first &&
    points.length >= 3 &&
    Math.hypot(raw.x - first.x, raw.y - first.y) <= CLOSE_DISTANCE
  ) {
    return { kind: 'close' };
  }

  const point = snap(raw, points);
  const last = points.at(-1);
  if (last && last.x === point.x && last.y === point.y) return { kind: 'ignore' };
  return { kind: 'add', point };
}

/** The shape a finished draft makes, or `null` when it is not yet a shape anybody could lay. */
export function finishedGeometry(
  points: Point[],
  placement: DraftPlacement,
  width: number,
): PlanGeometry | null {
  const geometry: PlanGeometry =
    placement === 'polygon'
      ? { kind: 'polygon', points, cornerRadius: 0 }
      : { kind: 'polyline', points, width };
  return vertexEditIsValid(geometry) ? geometry : null;
}
