import type { LayoutArchetypeId } from '@garden-studio/schema';
import { formalAxis, sweepingLawn, terraceAndLawn } from './classic.js';
import { courtyard } from './courtyard.js';
import { destinationGarden } from './destination-garden.js';
import { linearSequence } from './linear-sequence.js';
import { sideBySide } from './side-by-side.js';
import type { LayoutArchetype } from './types.js';

/**
 * Every way this generator knows to compose a garden.
 *
 * Three of them are the templates that already existed, named for what they are. The other four are
 * the compositions those three cannot express, and each was added because the harness or a scenario
 * showed a plot they handled badly rather than because the list looked short:
 *
 * - **side_by_side** — a wide shallow plot has no "behind the terrace", so the rooms go beside each
 *   other. All three originals lay their rooms along the depth and produced a strip.
 * - **linear_sequence** — a corridor plot wants its length broken into rooms you cannot see past.
 *   Run as one room it reads as exactly what it is.
 * - **courtyard** — the originals handle a small garden by dropping the lawn and stopping, which is
 *   a fallback rather than a plan. The fixture bands record the result: 37–45% of the ground
 *   reading as base showing through.
 * - **destination_garden** — a deep plot where the far end is the reason to go out. The pieces
 *   existed (`far-room`, `wantsLoungeRoom`); the intent did not.
 *
 * Order is the tie-break when two score the same, so the general-purpose plan leads and the
 * specialised ones follow.
 */
export const ARCHETYPES: LayoutArchetype[] = [
  terraceAndLawn,
  sweepingLawn,
  formalAxis,
  sideBySide,
  linearSequence,
  destinationGarden,
  courtyard,
];

const BY_ID = new Map(ARCHETYPES.map((archetype) => [archetype.id, archetype]));

export function archetypeById(id: LayoutArchetypeId): LayoutArchetype {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`No layout archetype named ${id}`);
  return found;
}

export {
  terraceAndLawn,
  sweepingLawn,
  formalAxis,
  sideBySide,
  linearSequence,
  destinationGarden,
  courtyard,
};
export { DEFAULT_PARAMS, defaultParams, ZONE_BY_SLOT, zoneOfSlot } from './types.js';
export type { LayoutArchetype } from './types.js';
