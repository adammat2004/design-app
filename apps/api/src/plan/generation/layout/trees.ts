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
 * On a composed sketch every tree is one the composition placed for a reason, and a point that has
 * drifted onto the lawn is not offered: a nudge that carries a framing tree out of its bed and into
 * the grass has made it a specimen marooned in open ground, which is the thing it was placed to
 * avoid. On a hand-drawn sketch the sketch's own points come first and then the backdrop walk round
 * the room, as before.
 */
export function treeCandidates(
  sketch: LayoutSketch,
  frame: DesignFrame,
  room: Point[],
  nudgeStart: number,
): TreeCandidate[] {
  const ladder = TREE_NUDGES.slice(nudgeStart % TREE_NUDGES.length);
  const lawn = sketch.composed && sketch.lawn ? localShapeRing(sketch.lawn, frame) : null;
  const offLawn = (at: Point) => !lawn || !pointInPolygon(at, lawn);

  const planned: TreeCandidate[] = sketch.trees.map((point, index) => ({
    points: ladder.map(([du, dv]) => frame.toWorld(point.u + du, point.v + dv)).filter(offLawn),
    purpose: sketch.composed?.treeRoles[index]?.purpose ?? 'framing-tree',
  }));
  if (sketch.composed) return planned;

  /*
   * The backdrop the hand-drawn compositions never had: a line of trees along the boundary, the
   * thing that encloses the garden and gives everything else a scale. Walked here rather than
   * written into each template, because it is the same move in all of them.
   */
  const walk: TreeCandidate[] = [];
  for (let corner = 0; corner < room.length; corner += 1) {
    const from = room[corner]!;
    const to = room[(corner + 1) % room.length]!;
    const run = Math.hypot(to.x - from.x, to.y - from.y);
    if (run < BACKDROP_TREE_SPACING) continue;

    const steps = Math.floor(run / BACKDROP_TREE_SPACING);
    const inward = { x: -(to.y - from.y) / run, y: (to.x - from.x) / run };
    for (let step = 1; step <= steps; step += 1) {
      const t = step / (steps + 1);
      const on = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      /* Which side of the edge is the garden is not known here, so both are offered. */
      walk.push({
        points: [1, -1].map((direction) => ({
          x: on.x + inward.x * direction * BACKDROP_TREE_INSET,
          y: on.y + inward.y * direction * BACKDROP_TREE_INSET,
        })),
        purpose: 'backdrop-tree',
      });
    }
  }
  return [...planned, ...walk];
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
