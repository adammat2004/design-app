import type { PrincipleId } from '@garden-studio/schema';

/**
 * What a garden design is judged on, and how much each thing counts.
 *
 * A table rather than a formula, so the weighting is something a person can argue with and a
 * reviewer can see. The numbers are a claim about landscape design rather than a tuning: how you
 * move round a garden and whether the things in it are grouped sensibly are what a designer fixes
 * first, proportion and relationships next, and style coherence is the last thing to compromise
 * because it is the easiest to recover in materials.
 *
 * Three properties worth keeping when these change:
 *
 * - **They are renormalised, never assumed to sum to one.** A principle that does not apply to a
 *   plan — no location, so nothing can be said about shade — is dropped and the rest are scaled
 *   back up. Scoring an unlocated garden zero for sun would mark down every plan drawn before step
 *   1 grew a location field. The eight principles that always apply do sum to one, and the two
 *   conditional ones sit *on top* of them at 0.05 each: a located plan whose owner stated an upkeep
 *   level is judged on ten things and one that stated neither on eight, and neither is penalised for
 *   what the other knows.
 * - **They are a base, not the final answer.** `weightProfile` shifts them by what the concept is
 *   *for* — an entertaining garden weighs how its spaces relate more heavily than a planted one
 *   does — and renormalises. This table is what that starts from, and what it falls back to.
 * - **`featureFit` is not in the table.** It is a gate: a concept missing an essential feature has
 *   its total capped rather than reduced, because it is the wrong concept rather than a worse one.
 * - **Nothing here has authority over geometry.** Change every weight and the same set of legal
 *   plans is produced; only which one is offered first changes.
 */

export interface Principle {
  id: PrincipleId;
  /** Relative weight. Renormalised over whichever principles actually applied. */
  weight: number;
  /** Why it counts for what it counts. */
  reason: string;
}

export const PRINCIPLES: Principle[] = [
  {
    id: 'circulation',
    weight: 0.2,
    reason:
      'How you get round a garden is the first thing that makes it usable and the first thing a designer draws.',
  },
  {
    id: 'grouping',
    weight: 0.2,
    reason:
      'Things that belong together standing together is the difference between rooms and scattered objects.',
  },
  {
    id: 'proportion',
    weight: 0.15,
    reason:
      'The shares of hard landscaping, lawn and planting, against a hand-traced professional plan.',
  },
  {
    id: 'relationships',
    weight: 0.15,
    reason:
      'The barbecue by the table, the shed out of the view, the play area where it can be watched.',
  },
  {
    id: 'privacy',
    weight: 0.1,
    reason: 'Whether you can sit in it without being overlooked — the first thing a client raises.',
  },
  {
    id: 'hierarchy',
    weight: 0.1,
    reason: 'One main space and somewhere for the eye to land, rather than equal rectangles.',
  },
  {
    id: 'style',
    weight: 0.05,
    reason:
      'Alignment, material count and massing. Last because it is the easiest to recover in materials.',
  },
  {
    id: 'buildability',
    weight: 0.05,
    reason:
      'Beds you can plant, structures you can get round, a way down off anything raised. Usually a centimetre, not a rethink.',
  },
  {
    id: 'sun',
    weight: 0.05,
    reason:
      'Whether the seating gets the afternoon. Only when the site has a location: there is no shade that is true of anywhere.',
  },
  {
    id: 'maintenanceFit',
    weight: 0.05,
    reason:
      'How much work the garden asks for against how much was offered. Only when the user said: an upkeep level nobody stated is not a standard to mark against.',
  },
  {
    id: 'canopy',
    weight: 0.05,
    reason:
      'Whether anything grows over the garden. Every other principle can be satisfied by a flat plan with no trees in it, so without this the loop had no reason to prefer the fuller one.',
  },
];

export const PRINCIPLE_WEIGHTS: Record<string, number> = Object.fromEntries(
  PRINCIPLES.map((principle) => [principle.id, principle.weight]),
);

/**
 * The principles that only apply when the document says enough to ask them.
 *
 * `sun` needs a location; `maintenanceFit` needs an upkeep level; `canopy` needs a room big enough
 * for a tree to be a question. All three sit on top of the eight that always apply rather than among
 * them, so a plan that can answer none of them is judged on eight things out of eight rather than on
 * eight out of eleven.
 */
export const CONDITIONAL: PrincipleId[] = ['sun', 'maintenanceFit', 'canopy'];

/**
 * The score a candidate must reach to be offered without qualification.
 *
 * Not a hard floor — a small awkward plot may not be able to do better, and offering the best of a
 * hard site is more useful than offering nothing. It is where the repair loop stops trying.
 */
export const GOOD_ENOUGH = 0.85;

/** Below this a candidate is a weak plan, and the eval harness reports it as one. */
export const WEAK = 0.6;
