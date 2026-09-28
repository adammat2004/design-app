import type { CandidateParams } from '../../design/types.js';
import { composed, styleLanguages } from './composed.js';

import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "A sequence of rooms" — the long narrow plan.
 *
 * A corridor garden is the one shape where showing the whole plot from the doors is the mistake. A
 * six-by-twenty-eight-metre plot laid out as terrace, lawn, far corner is a long thin lawn you can
 * see the end of, which reads as exactly what it is: a strip. The move every designer makes instead
 * is to break the length into rooms and stop you seeing past the first one — so the garden is
 * revealed a room at a time and feels longer rather than shorter.
 *
 * Three or four bands along `u`, each the full width of the plot, separated by planting that runs
 * **most of the way across** and alternates sides. The path threads through the gaps, so it swings
 * from one side to the other and no two rooms are in line.
 */

/** Below this depth-to-width ratio the plot is not a corridor and an ordinary plan is better. */
const MIN_RATIO = 1.9;

/** The shortest a room in the sequence may be, front to back. */
const MIN_BAND = 3.2;

export const linearSequence: LayoutArchetype = {
  id: 'linear_sequence',
  name: 'A sequence of rooms',
  summary:
    'The length broken into rooms rather than run as one strip, with planting across the garden between them and a path that swings side to side so you never see the whole plot at once.',
  tone: 'Natural',
  circulation: ['meander', 'direct'],
  proportions: {
    terrace: { min: 0.1, max: 0.3 },
    lawn: { min: 0.12, max: 0.45 },
    planting: { min: 0.2, max: 0.5 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const width = site.roomWidth ?? 0;
    const depth = site.roomDepth ?? 0;
    if (width <= 0 || depth <= 0)
      return { score: 0, reasons: ['No room behind the doors to divide.'] };

    const ratio = depth / width;
    if (ratio < MIN_RATIO) {
      return {
        score: 0,
        reasons: [
          `The room behind the doors is ${depth.toFixed(0)} × ${width.toFixed(0)} m, not long enough to be worth dividing.`,
        ],
      };
    }
    if (depth < MIN_BAND * 3) {
      return { score: 0, reasons: ['Too short to make three rooms of any use.'] };
    }

    const reasons = [
      `A ${depth.toFixed(0)} m garden only ${width.toFixed(0)} m wide: broken into rooms it feels longer, run as one strip it feels like a corridor.`,
    ];
    return { score: 0.95, reasons };
  },

  params() {
    /* The far room centred: a corridor garden is too narrow for a room on the diagonal. */
    const first: CandidateParams = {
      ...defaultParams('linear_sequence'),
      destination: 'far-centre',
    };
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: 'away' },
      { ...first, terraceDepth: 0.85 },
    ];
    return variants;
  },

  /*
   * Composed: the terrace, a lawn entered through an opening in a planted divider, a second divider,
   * and the room at the far end, with the path down the side through the gaps. Where it declines — a
   * plot with nothing that belongs at the far end — the loop offers another composition.
   */
  ...composed('linear_sequence', styleLanguages, { primary: ['destination'] }),
};
