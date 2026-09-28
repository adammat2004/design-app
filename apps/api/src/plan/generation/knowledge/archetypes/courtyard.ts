import { isCourtyard } from '../../layout/sketch.js';

import { composed } from './composed.js';

import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Courtyard" — the small garden that is a room rather than a view.
 *
 * The three original templates all handle a courtyard by *giving up*: `isCourtyard` turns true, the
 * lawn is dropped, and what is left is a terrace with one slot in the leftover space. That is an
 * honest fallback and it is not a composition — the plan comes out as paving with a shed on it, and
 * the fixture bands record the consequence, 37 to 45% of the ground reading as base showing through.
 *
 * A courtyard designed as a courtyard is the opposite of a garden designed as a view. The paving is
 * the floor of the room and runs corner to corner; the planting is deep against the walls rather
 * than a token strip; there is one thing worth looking at on the wall opposite the doors; and
 * nothing is in the middle, because the middle is where you stand.
 */

/**
 * What makes a garden a courtyard.
 *
 * `isCourtyard` — the rule the sketch layer already uses to decide whether a plan gets a lawn at
 * all. Reusing it rather than declaring an area threshold of this file's own is the whole point: a
 * second answer to "is this a courtyard" is exactly the kind of drift that had a 9 × 10 m garden
 * paved corner to corner because ninety square metres happened to be under the number chosen here.
 */

/*
 * The floor, the beds and the rooms carved off the floor live in the composition layer
 * (`design/composition/court.ts`). It is also what every other composition falls back to where it
 * declines, drawn so that it cannot decline itself (`lastResort` in `composed.ts`).
 */

export const courtyard: LayoutArchetype = {
  id: 'courtyard',
  name: 'Courtyard',
  summary:
    'A paved floor corner to corner with deep planting against the walls and one thing worth looking at opposite the doors. Nothing in the middle, because the middle is where you stand.',
  tone: 'Structured',
  circulation: ['direct'],
  proportions: {
    terrace: { min: 0.35, max: 0.75 },
    lawn: { min: 0, max: 0.1 },
    planting: { min: 0.2, max: 0.5 },
  },
  hosts: ['terrace', 'dining', 'planting', 'water', 'destination', 'utility', 'play', 'productive'],

  suitability(site, brief) {
    const depth = site.roomDepth ?? 0;
    const width = site.roomWidth ?? 0;

    if (depth <= 0 || width <= 0) {
      return { score: 0, reasons: ['No room behind the doors at all.'] };
    }

    /*
     * Two ways to earn this: no lawn will fit, or none was wanted. A minimalist garden with no
     * grass in it is a courtyard whatever its size, and treating it as a lawn plan with the lawn
     * taken out is how a large one came out as gravel with things standing on it.
     */
    const noLawn = brief.excludedFeatures.some((entry) => entry.feature === 'lawn');
    const noRoomForLawn = isCourtyard(site.scale.sizeFactor, depth, width);

    if (!noLawn && !noRoomForLawn) {
      return {
        score: 0,
        reasons: [
          `${Math.round(depth * width)} m² behind the doors, which holds a lawn — and a courtyard is a garden that does not.`,
        ],
      };
    }

    const reasons = noLawn
      ? [
          'No lawn was wanted, so the paving is the floor of the garden rather than a terrace on it.',
        ]
      : [`No lawn fits behind the doors: a room to be in rather than a view to look at.`];

    return { score: 0.95, reasons };
  },

  params() {
    /*
     * Few ways to lay out a paved room, and each is a real choice: the room as designed, a smaller
     * floor with deeper planting, the far room centred on the view rather than in the corner, and the
     * second room on the gate side so the far side stays planted. Courtyards used to have one, and
     * three cards drawn from one variation are one answer three times.
     */
    const first = defaultParams('courtyard');
    return [
      first,
      { ...first, terraceDepth: 0.85 },
      { ...first, destination: 'far-centre' },
      { ...first, lawnBias: 'away' },
    ];
  },

  /*
   * Composed: every room in a place the fitter will seat it, a purpose on every element, and a
   * feature the courtyard has no room for reported rather than stood on the floor. Where it declines
   * — an essential feature with nowhere off the floor to go — the loop offers another composition.
   */
  ...composed('courtyard', ['rectilinear']),
};
