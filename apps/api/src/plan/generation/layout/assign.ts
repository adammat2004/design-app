import type { DesiredFeature } from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import type { LayoutSketch, SlotKind } from './sketch.js';

/**
 * Which slot each requested feature is tried in, in order of preference.
 *
 * This is the one table that turns "the brief asked for a fire pit" into "at the far end of the
 * garden, not beside the back door" — the difference between a plan that reads as designed and
 * one that reads as scattered. Seating is the terrace itself: the terrace exists in every plan,
 * and asking for seating furnishes it.
 */
const PREFERENCES: Record<DesiredFeature, SlotKind[]> = {
  seating: ['terrace'],
  // Off the end of the terrace rather than on it: the terrace is already somewhere to sit, and a
  // table set down in the middle of it leaves neither room its own floor.
  dining: ['terrace-end', 'beside-terrace', 'far-room', 'lawn-far'],
  pergola: ['terrace-end', 'axis-end', 'far-room'],
  outdoorKitchen: ['beside-terrace'],
  // A tub is used in the dark and in a dressing gown, so it stays within reach of the door.
  hotTub: ['terrace-corner', 'beside-terrace', 'far-room'],
  firePit: ['far-room', 'lawn-far', 'axis-end'],
  play: ['lawn-far', 'far-room'],
  storage: ['utility', 'utility-2'],
  vegPatch: ['utility-2', 'utility', 'lawn-far'],
  greenhouse: ['utility-2', 'utility', 'far-room'],
  // A room of its own, so it takes the far room before it takes a utility bay.
  gardenRoom: ['far-room', 'lawn-far', 'utility'],
  water: ['axis-end', 'terrace-corner', 'far-room'],
  /*
   * The three composed answers. `concepts.service.ts` settles them from what the template and the
   * lighting pass actually drew and never asks for a slot, so these lists are unreachable — they
   * exist because the table is total, and they name a sensible slot anyway rather than `[]`, which
   * would read as "there is nowhere this can go".
   */
  lawn: ['lawn-far'],
  plantingBeds: ['lawn-far', 'far-room'],
  lighting: ['far-room'],
  other: ['far-room', 'lawn-far', 'beside-terrace'],
};

/** Water goes on the axis in a formal plan; elsewhere the axis slot does not exist, so no harm. */
export function slotPreferences(feature: DesiredFeature): SlotKind[] {
  return PREFERENCES[feature];
}

export interface Assignment {
  feature: DesiredFeature;
  slotId: string;
}

/**
 * Hands each requested feature the first free slot on its list, in the order the brief listed
 * them. Features with nothing left free are returned in `unassigned` for the caller's fallback.
 */
export function assignSlots(
  sketch: LayoutSketch,
  features: DesiredFeature[],
): { assigned: Assignment[]; unassigned: DesiredFeature[] } {
  const free = new Map(sketch.slots.map((slot) => [slot.id, slot]));
  const assigned: Assignment[] = [];
  const unassigned: DesiredFeature[] = [];

  for (const feature of features) {
    // In preference order: the first free slot of the first kind on the list that has one.
    const chosen = slotPreferences(feature)
      .map((kind) => [...free.values()].find((candidate) => candidate.kind === kind))
      .find((candidate) => candidate !== undefined);

    if (!chosen) {
      unassigned.push(feature);
      continue;
    }

    free.delete(chosen.id);
    assigned.push({ feature, slotId: chosen.id });
  }

  return { assigned, unassigned };
}

/**
 * The same assignment, but **the room a feature belongs to is tried before its slot ladder**.
 *
 * `assignSlots` walks a fixed preference list of slot *kinds*, which was the only vocabulary there
 * was: a pergola went wherever `terrace-end` happened to be. With zones on the slots a feature can
 * ask for its own room first — the pergola belongs to the dining area, the store to the utility
 * corner — and fall back to the ladder only when the composition has no such room or it is taken.
 *
 * The ladder is kept rather than replaced, and that matters: several features legitimately span
 * rooms. Water is `axis-end`, then `terrace-corner`, then `far-room`; a hot tub is by the terrace
 * or, failing that, at the far end. Dropping the ladder would refuse those rather than move them.
 *
 * **Callers pass the features already in priority order**, which is the other half of the change.
 * `assignSlots` took them in the order the brief listed them, so a fire pit ticked before a terrace
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
      slotPreferences(feature)
        .map((kind) => [...free.values()].find((candidate) => candidate.kind === kind))
        .find((candidate) => candidate !== undefined);

    if (!chosen) continue;
    free.delete(chosen.id);
    assigned.push({ feature, slotId: chosen.id });
  }

  return assigned;
}
