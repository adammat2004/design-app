import type { Point } from '@garden-studio/schema';
import { isOnScreen } from './canvas-transform';

/**
 * Keeping overlay labels off each other's toes.
 *
 * A real garden has five to ten labelled things and they will sit on top of one another.
 * Rather than let them pile up, anything overlapping the label above it is pushed down —
 * cheap, stable, and it keeps every label attached to something.
 *
 * Extracted from step 2's feature labels so step 4's concept labels stack by exactly the same
 * rule. Two copies would be two sets of spacing constants, and the moment they disagreed the
 * same garden would label itself differently depending on which screen you were on.
 */

/** Rough on-screen height of one full label block: name, size line, and a pill. */
export const LABEL_HEIGHT = 34;

/** A collapsed chip is barely taller than its icon, so it needs far less room reserved. */
export const CHIP_HEIGHT = 22;

export interface Stackable {
  at: Point;
  /** Full block, or collapsed to a chip. Decides how much room the next label has to clear. */
  full: boolean;
}

/**
 * Drops anything off screen, then walks top to bottom pushing each label clear of the one
 * above it. Generic over the payload so the caller keeps its own type.
 */
export function stackLabels<T extends Stackable>(
  candidates: T[],
  size: { width: number; height: number },
): T[] {
  const visible = candidates
    .filter(({ at }) => isOnScreen(at, size))
    .sort((a, b) => a.at.y - b.at.y);

  let lowestBottom = Number.NEGATIVE_INFINITY;

  return visible.map((candidate) => {
    const y = Math.max(candidate.at.y, lowestBottom);
    lowestBottom = y + (candidate.full ? LABEL_HEIGHT : CHIP_HEIGHT);

    return { ...candidate, at: { x: candidate.at.x, y } };
  });
}
