import { isCourtyard, LAWN_FLOOR, terraceFloor } from '../../layout/sketch.js';
import type { CandidateParams } from '../../design/types.js';
import { lawnDepthBehindTerrace, SHALLOW_LAWN } from './shared.js';

import { composed } from './composed.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Terrace and lawn, side by side" — the wide shallow plan.
 *
 * The composition the three original templates could not express, and the reason a wide shallow
 * garden came out badly. All three of them lay their rooms **along `u`**: terrace at the doors,
 * lawn behind it, destination behind that. On a plot twenty-two metres across and nine deep there
 * is no "behind" — after a terrace and a rear border the lawn is a strip — so the plan either
 * refused the lawn or drew one two metres from front to back.
 *
 * Here the rooms are laid along `v` instead, which is where the space actually is: the terrace on
 * the doors, the lawn beside it running the full depth, the utility corner at the far end of the
 * wall and planting along the back and the two ends. Nothing is behind anything.
 */

/** Below this width there is nothing to lay side by side, and the ordinary plan is better. */
const MIN_WIDTH = 12;

/*
 * `TERRACE_SHARE` and `ACCESS_LANE` live with the composer (`design/composition/beside.ts`), which is
 * what draws this plan. `ACCESS_LANE` is wider than `PASSAGE_ACCESS_WIDTH` on purpose: the route drawn through it is the
 * 1.2 m access circulation, and a one-metre lane cannot hold it.
 */

/** Past this depth-to-width ratio the plot is not shallow and the long-axis plans win. */
const MAX_RATIO = 0.75;

/**
 * The least a lawn beside a terrace may be across.
 *
 * `LAWN_FLOOR`, the floor every other composition already uses, rather than a number of this
 * file's own. The first version said four metres, which looks reasonable and is a *second* answer
 * to a question that was already settled — on the main test fixture it refused a 3.8 m wide, 26 m²
 * lawn, so the plan came out with no open ground at all.
 */
const LAWN_MIN_WIDTH = LAWN_FLOOR.minDimension;

export const sideBySide: LayoutArchetype = {
  id: 'side_by_side',
  name: 'Terrace and garden side by side',
  summary:
    'The terrace on the doors and the lawn beside it rather than behind, so a wide shallow plot reads as two rooms across the garden instead of one strip.',
  tone: 'Structured',
  circulation: ['direct', 'perimeter'],
  proportions: {
    terrace: { min: 0.15, max: 0.4 },
    lawn: { min: 0.15, max: 0.5 },
    planting: { min: 0.15, max: 0.4 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const width = site.roomWidth ?? 0;
    const depth = site.roomDepth ?? 0;

    if (width < MIN_WIDTH) {
      return {
        score: 0,
        reasons: [`Only ${width.toFixed(1)} m across: there is nothing to lay side by side.`],
      };
    }
    /*
     * The bands run the full depth and the full width, so this composition assumes a rectangle. On
     * an L the lawn band is laid across the notch, the clip takes most of it away and the plan comes
     * out with no open ground at all — which is what the l-shape fixture's composition bands caught.
     */
    if (site.shape === 'irregular') {
      return {
        score: 0,
        reasons: [
          'The room behind the doors is not a rectangle, so bands across it fall outside it.',
        ],
      };
    }
    if (depth <= 0 || depth / width > MAX_RATIO) {
      return {
        score: 0,
        reasons: [
          'The room behind the doors is deeper than it is wide, so the rooms belong in sequence.',
        ],
      };
    }
    if (
      width - terraceFloor({ uMin: 0, uMax: depth, vMin: -width / 2, vMax: width / 2 }).width <
      LAWN_MIN_WIDTH
    ) {
      return {
        score: 0,
        reasons: ['No room for a lawn beside the terrace once the terrace has its floor.'],
      };
    }

    /*
     * And the room has to be deep enough to hold one at all. This composition's whole premise is a
     * lawn *beside* a terrace; on a room too shallow for any lawn it draws a terrace, a border and
     * bare ground, which is what a courtyard plan is for. `isCourtyard` is the shared rule the
     * sketch layer already uses, rather than a depth of this file's own.
     */
    if (isCourtyard(site.scale.sizeFactor, depth, width)) {
      return {
        score: 0,
        reasons: [
          `Only ${depth.toFixed(1)} m deep: no lawn fits beside the terrace or anywhere else.`,
        ],
      };
    }

    /*
     * **Scored on how much lawn would be left behind a terrace, not on the ratio.** A room twice as
     * wide as it is deep leaves a generous lawn at twenty metres deep and a two-metre strip at
     * eleven; the ratio is the same and the right plan is not. Where the strip is what is left, this
     * composition is the answer rather than a preference.
     */
    const behind = lawnDepthBehindTerrace(site.scale.sizeFactor, depth);
    const reasons = [
      behind < SHALLOW_LAWN
        ? `A lawn behind the terrace would be ${behind.toFixed(1)} m deep across ${width.toFixed(0)} m, so the rooms go beside each other instead.`
        : `The garden is ${width.toFixed(0)} m across and ${depth.toFixed(0)} m deep, so the rooms can go beside each other rather than behind.`,
    ];
    return { score: behind < SHALLOW_LAWN ? 0.95 : 0.7, reasons };
  },

  params() {
    const first = defaultParams('side_by_side');
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: 'away' },
      { ...first, terraceDepth: 1.15 },
    ];
    return variants;
  },

  /*
   * Composed: the lawn reserved beside the terrace, the rooms in bays round it — the far corner is
   * a bay the lawn is notched round rather than grass with a fire pit on it — and a path along the
   * house and down the fence to reach it. Where it declines, the loop offers another composition.
   */
  ...composed('side_by_side', ['rectilinear']),
};
