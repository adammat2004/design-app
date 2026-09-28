import type { DesiredFeature } from '@garden-studio/schema';
import { FEATURE_LIBRARY, placementLadder } from '../knowledge/feature-library.js';
import type { LayoutSketch } from './sketch.js';

export interface Assignment {
  feature: DesiredFeature;
  slotId: string;
}

/**
 * Hands each requested feature a slot, and **the room a feature belongs to is tried before its
 * slot ladder**.
 *
 * The first version walked a fixed preference list of slot *kinds*, which was the only vocabulary
 * there was: a pergola went wherever `terrace-end` happened to be. With zones on the slots a feature can
 * ask for its own room first — the pergola belongs to the dining area, the store to the utility
 * corner — and fall back to the ladder only when the composition has no such room or it is taken.
 *
 * The ladder is kept rather than replaced, and that matters: several features legitimately span
 * rooms. Water is `axis-end`, then `terrace-corner`, then `far-room`; a hot tub is by the terrace
 * or, failing that, at the far end. Dropping the ladder would refuse those rather than move them.
 *
 * **Callers pass the features already in priority order**, which is the other half of the change.
 * The first version took them in the order the brief listed them, so a fire pit ticked before a terrace
 * could take the slot the terrace wanted. Ordering is the caller's business — `withinCapacity` has
 * already sorted them — so this function only has to be stable.
 */
export function assignByPriority(sketch: LayoutSketch, features: DesiredFeature[]): Assignment[] {
  const free = new Map(sketch.slots.map((slot) => [slot.id, slot]));
  const assigned: Assignment[] = [];

  for (const feature of features) {
    const room = FEATURE_LIBRARY[feature].zone;

    const chosen =
      /* Its own room first, best slot within it. */
      [...free.values()].find((slot) => slot.zoneId === room) ??
      /* Then the ladder, which is what the slot kinds were always for. */
      placementLadder(feature)
        .map((kind) => [...free.values()].find((candidate) => candidate.kind === kind))
        .find((candidate) => candidate !== undefined);

    if (!chosen) continue;
    free.delete(chosen.id);
    assigned.push({ feature, slotId: chosen.id });
  }

  return assigned;
}
