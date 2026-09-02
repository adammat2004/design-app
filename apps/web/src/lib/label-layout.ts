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

/**
 * The widest a label's name may draw, in pixels.
 *
 * Names are user-supplied — the editor lets you rename anything — and the label is centred on the
 * thing it points at with `whitespace-nowrap`, so a long one grows in *both* directions and runs
 * off the canvas at each end. `stackLabels` cannot help: it resolves vertical collisions, and this
 * is a horizontal one it never sees.
 *
 * Truncation is left to CSS rather than done in JavaScript. `text-overflow: ellipsis` cuts at the
 * exact rendered pixel in whatever font actually loaded, where a character count is a guess that is
 * wrong for "Wildflower meadow" and "IIIIIIIIIIIIIIIII" in opposite directions. The full name goes
 * on `title`, so nothing is lost — it is one hover away.
 *
 * Shared for the same reason `stackLabels` is: two copies would be two numbers, and the moment they
 * disagreed the same garden would label itself differently depending on which screen you were on.
 */
export const LABEL_MAX_WIDTH = 132;

export interface Stackable {
  at: Point;
  /** Full block, or collapsed to a chip. Decides how much room the next label has to clear. */
  full: boolean;
}

/**
 * How far a label must be pushed before it needs a line back to what it names.
 *
 * Under this it still overlaps its own subject, so a leader would be a mark drawn from a thing to
 * itself — noise on a drawing that is mostly about restraint.
 */
export const LEADER_MIN_PX = 6;

/**
 * A laid-out label: where it is drawn, and where the thing it names actually is.
 *
 * Keeping both is the point. `stackLabels` resolves collisions by pushing labels down the screen,
 * and it used to overwrite `at` and throw the original away — so the moment two features were close
 * enough to collide, the label that moved was left pointing at nothing in particular. On a plan
 * with five or six labelled things, which is most of them, that is the common case rather than the
 * edge one.
 */
export type Stacked<T> = T & {
  /** Where the thing being labelled is, before any collision was resolved. */
  anchor: Point;
  /** Whether it was pushed far enough to need a leader line drawn back to `anchor`. */
  displaced: boolean;
};

/**
 * Drops anything off screen, then walks top to bottom pushing each label clear of the one
 * above it. Generic over the payload so the caller keeps its own type.
 */
export function stackLabels<T extends Stackable>(
  candidates: T[],
  size: { width: number; height: number },
): Stacked<T>[] {
  const visible = candidates
    .filter(({ at }) => isOnScreen(at, size))
    .sort((a, b) => a.at.y - b.at.y);

  let lowestBottom = Number.NEGATIVE_INFINITY;

  return visible.map((candidate) => {
    const y = Math.max(candidate.at.y, lowestBottom);
    lowestBottom = y + (candidate.full ? LABEL_HEIGHT : CHIP_HEIGHT);

    return {
      ...candidate,
      at: { x: candidate.at.x, y },
      anchor: candidate.at,
      displaced: y - candidate.at.y > LEADER_MIN_PX,
    };
  });
}
