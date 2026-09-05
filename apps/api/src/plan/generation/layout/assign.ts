import type { DesiredFeature } from '@garden-studio/schema';
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
  pergola: ['terrace-end', 'axis-end', 'far-room'],
  outdoorKitchen: ['beside-terrace'],
  firePit: ['far-room', 'lawn-far', 'axis-end'],
  play: ['lawn-far', 'far-room'],
  storage: ['utility', 'utility-2'],
  vegPatch: ['utility-2', 'utility', 'lawn-far'],
  water: ['axis-end', 'terrace-corner', 'far-room'],
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
    const wanted = slotPreferences(feature);
    const slot = [...free.values()].find((candidate) => wanted.includes(candidate.kind));

    // Preference order first, then whatever is left in that order.
    const preferred = wanted
      .map((kind) => [...free.values()].find((candidate) => candidate.kind === kind))
      .find((candidate) => candidate !== undefined);

    const chosen = preferred ?? slot;
    if (!chosen) {
      unassigned.push(feature);
      continue;
    }

    free.delete(chosen.id);
    assigned.push({ feature, slotId: chosen.id });
  }

  return { assigned, unassigned };
}
