import { pointInPolygon, type Point } from '@garden-studio/schema';
import type { DesignFrame } from './frame.js';
import type { LayoutSketch, LocalShape } from './sketch.js';

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

export function treeBudget(designedArea: number): number {
  return Math.max(MIN_TREES, Math.min(MAX_TREES_CAP, Math.round(designedArea / METRES_PER_TREE)));
}

/** Offsets tried for a sketched tree, in frame metres: where it was drawn, then nearby. */
export const TREE_NUDGES: [number, number][] = [
  [0, 0],
  [-0.6, 0],
  [0.6, 0],
  [0, -0.6],
  [0, 0.6],
  [-1.2, 0],
  [1.2, 0],
  [0, -1.2],
  [0, 1.2],
  [-1.2, -1.2],
  [1.2, 1.2],
];

/** One tree the plan wants, as the points it may stand at in order, and why it is there. */
export interface TreeCandidate {
  points: Point[];
  purpose: string;
}

/**
 * Every tree the plan wants, in the order it wants them, each with the points it may stand at.
 *
 * **One list, read by the preview and the realisation alike.** Each had its own nudge ladder and its
 * own walk round the boundary, with a comment in each saying the other must plant exactly as many:
 * a preview that plants five where the built plan plants eleven scores a garden nobody sees. The
 * caller decides only whether a point *fits*, which is the one thing the two genuinely ask
 * differently — the realisation knows about the shed's roof, the preview only about its outline.
 *
 * Every tree is one the composition placed for a reason, and a point that has drifted onto the lawn
 * is not offered: a nudge that carries a framing tree out of its bed and into the grass has made it
 * a specimen marooned in open ground, which is the thing it was placed to avoid. The walk round the
 * boundary every five metres that the hand-drawn templates relied on went with them.
 */
export function treeCandidates(
  sketch: LayoutSketch,
  frame: DesignFrame,
  nudgeStart: number,
): TreeCandidate[] {
  const ladder = TREE_NUDGES.slice(nudgeStart % TREE_NUDGES.length);
  const lawn = sketch.lawn ? localShapeRing(sketch.lawn, frame) : null;
  const offLawn = (at: Point) => !lawn || !pointInPolygon(at, lawn);

  const planned: TreeCandidate[] = sketch.trees.map((point, index) => ({
    points: ladder.map(([du, dv]) => frame.toWorld(point.u + du, point.v + dv)).filter(offLawn),
    purpose: sketch.composed.treeRoles[index]?.purpose ?? 'framing-tree',
  }));
  return planned;
}

/** A sketch shape as a ring in world metres. */
export function localShapeRing(shape: LocalShape, frame: DesignFrame): Point[] {
  if (shape.kind === 'rect') {
    const { rect } = shape;
    return [
      frame.toWorld(rect.u0, rect.v0),
      frame.toWorld(rect.u1, rect.v0),
      frame.toWorld(rect.u1, rect.v1),
      frame.toWorld(rect.u0, rect.v1),
    ];
  }
  return shape.points.map((point) => frame.toWorld(point.u, point.v));
}
