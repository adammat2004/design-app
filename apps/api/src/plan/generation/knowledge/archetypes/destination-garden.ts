import { composed, styleLanguages } from './composed.js';

import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Somewhere to walk to" — the garden whose point is the far end.
 *
 * The nearest thing to a composition the old generator already had: `wantsLoungeRoom` puts a second
 * seating room on a big plan, and `far-room` exists in every template. What was missing is the
 * *intent*. A destination garden is not a plan with a room at the end of it; it is a plan built so
 * that the room at the end is the reason you go out — the terrace is smaller than it would
 * otherwise be, the route to the far room is deliberate and slightly indirect, and the planting
 * deepens as you go so the far end feels further away than it is.
 *
 * It needs real depth and a reason. A fire pit, a second seat or a garden room at the far end is
 * the reason; without one the walk arrives nowhere and this is just a terrace-and-lawn plan with a
 * longer path.
 */

/** Under this there is nowhere far enough away to be a destination. */
const MIN_DEPTH = 12;

/** The features that can be the thing at the end of the walk. */
const DESTINATIONS = ['firePit', 'gardenRoom', 'hotTub', 'water', 'seating', 'dining'];

export const destinationGarden: LayoutArchetype = {
  id: 'destination_garden',
  name: 'Somewhere to walk to',
  summary:
    'A smaller terrace at the doors and a second place at the far end worth the walk, with the route to it slightly indirect and the planting deepening as you go.',
  tone: 'Natural',
  circulation: ['meander', 'direct'],
  proportions: {
    terrace: { min: 0.08, max: 0.25 },
    lawn: { min: 0.18, max: 0.5 },
    planting: { min: 0.2, max: 0.45 },
  },
  hosts: [
    'terrace',
    'dining',
    'lawn',
    'destination',
    'lounge',
    'utility',
    'productive',
    'planting',
  ],

  suitability(site, brief) {
    const depth = site.roomDepth ?? 0;
    if (depth < MIN_DEPTH) {
      return {
        score: 0,
        reasons: [
          `Only ${depth.toFixed(0)} m deep: nowhere far enough from the house to be worth walking to.`,
        ],
      };
    }

    /*
     * The reason has to exist. A destination garden whose destination is an empty corner is a plan
     * that promises something it does not draw, which is exactly the class of silent fiction the
     * focal strategy refuses to invent.
     */
    const reason = brief.featurePriorities.find((entry) => DESTINATIONS.includes(entry.feature));
    if (!reason) {
      return {
        score: 0,
        reasons: ['Nothing was asked for that would be worth putting at the far end.'],
      };
    }

    return {
      score: brief.focal === 'far-corner' || brief.emphasis === 'planted' ? 0.9 : 0.7,
      reasons: [
        `${depth.toFixed(0)} m is far enough for the far end to be its own place rather than the back of the lawn.`,
      ],
    };
  },

  params() {
    /*
     * The destination centred at the far end first: it is the end of the view from the doors, which
     * is what makes it the reason to walk. On the diagonal it is the same plan turned, reached down
     * the same side, and offered as a variation rather than the answer.
     */
    const first = {
      ...defaultParams('destination_garden'),
      terraceDepth: 0.85 as const,
      destination: 'far-centre' as const,
    };
    return [
      first,
      { ...first, lawnBias: 'away' as const },
      { ...first, terraceDepth: 1 as const },
      { ...first, destination: 'far-diagonal' as const },
    ];
  },

  /*
   * Composed, like the classic three: the room at the far end is decided first and the lawn stops
   * short of it behind a planted screen, with the walk down the side of the lawn and in along the
   * room's front. Where it declines, the loop offers another composition.
   */
  ...composed('destination_garden', styleLanguages, {
    primary: ['destination', 'lounge'],
  }),
};
