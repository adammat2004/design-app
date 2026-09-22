/**
 * How many trees a garden this size should carry, and where the boundary ones stand.
 *
 * Pure and shared, because two places plant trees and they have to agree: `concepts.service`
 * builds the plan somebody sees, and `design/layout-generator` previews fifty candidates to decide
 * which plan that is. A preview that plants five where the realised pipeline plants eleven is
 * scoring a different garden — enclosure, canopy and the sightlines the extra trees interrupt are
 * all measured on a drawing nobody will ever look at, and the candidate that wins is the winner of
 * a comparison that did not happen. The literal `5` used to be written out in both.
 */

/**
 * How much garden one tree is worth, in square metres.
 *
 * Read off the reference rather than chosen: `target_design.png` carries about ten canopies over a
 * garden of roughly two hundred and twenty square metres. A flat cap of five — whatever the plot —
 * gave a large garden the same three or four specimens marooned in open lawn as a small one, and
 * that is the largest single reason ours reads as emptier than a designed plan however good the
 * planting in its borders is.
 */
export const METRES_PER_TREE = 22;

/** Even a courtyard gets a tree or two; even an estate stops short of a wood. */
export const MIN_TREES = 3;
export const MAX_TREES_CAP = 12;

/**
 * How far apart the boundary trees stand, and how far in from the edge their trunks sit.
 *
 * Five metres is a screen rather than an avenue: close enough that two neighbours' crowns meet as
 * they grow, far enough that each is still a tree rather than a hedge. The inset is a trunk's own
 * standoff — the crown is allowed over the fence, the stem is not.
 */
export const BACKDROP_TREE_SPACING = 5;
export const BACKDROP_TREE_INSET = 1.1;

export function treeBudget(designedArea: number): number {
  return Math.max(MIN_TREES, Math.min(MAX_TREES_CAP, Math.round(designedArea / METRES_PER_TREE)));
}
