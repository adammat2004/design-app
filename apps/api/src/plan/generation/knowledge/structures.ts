import type { DesiredFeature, StyleDirection, SymbolId } from '@garden-studio/schema';
import type { SlotKind } from '../layout/sketch.js';

/**
 * Which structure a covered room becomes, decided from where the composition put it.
 *
 * ## A pergola by the terrace, a gazebo at the end of the garden
 *
 * The brief has one covered space, "pergola", and the generator places it where the composition has
 * room: beside the terrace as the dining room, or out at the far end as the thing the garden walks
 * to. Those are two different structures. A pergola is an open frame that extends a terrace — you
 * eat under it a stride from the kitchen. A room at the far end, standing on its own in the lawn or
 * the planting, is a gazebo: roofed, square, a place to sit that is worth the walk. So the slot's
 * *kind* decides, and on a traditional or natural brief the far one is drawn as a gazebo.
 *
 * On a modern or minimalist brief the far room stays a pergola: a flat-roofed frame is what those
 * styles build at the end of a garden, and the modern pergola preset is that frame.
 *
 * Keyed on the slot kind rather than its purpose word, because a bay the composition reserved for a
 * sun seat or an end seat carries its own purpose and is still a far room.
 */

/** Slots beside the terrace, whose room opens onto it rather than towards the house. */
export const TERRACE_SLOTS: SlotKind[] = ['terrace-end', 'beside-terrace', 'terrace-corner'];

/** Slots that stand a room away from the terrace: the destination and the end of the axis. */
const AWAY_SLOTS: SlotKind[] = ['far-room', 'axis-end'];

/** Styles whose garden-end shelter is a gazebo — Natural (`cottage`) and Traditional (`formal`). */
const GAZEBO_STYLES: (StyleDirection | null)[] = ['cottage', 'formal'];

export const GAZEBO_PLAN_NAME = 'Gazebo';

export interface HostChoice {
  /** Overrides the feature's own host symbol. */
  symbol?: SymbolId;
  /** Overrides the spec's plan name, and is what the preview and the realisation both call it. */
  planName?: string;
}

/**
 * The structure a feature's host is, given the slot it landed in. Pure; read by both the preview
 * (`record` in `layout-generator.ts`) and the realisation, so the two agree on the name that
 * `parity.test.ts` matches them by.
 */
export function hostChoice(
  feature: DesiredFeature,
  slotKind: SlotKind | null,
  style: StyleDirection | null,
): HostChoice {
  if (feature !== 'pergola' || !slotKind) return {};
  if (!AWAY_SLOTS.includes(slotKind) || !GAZEBO_STYLES.includes(style)) return {};
  return { symbol: 'gazebo', planName: GAZEBO_PLAN_NAME };
}

/**
 * Names a host may be given that are not a spec's `planName`, and the feature each still is — so the
 * scorer's relationship rules, the explanation and the eval harness's inclusion rate count a gazebo
 * as the pergola the user asked for.
 */
export const HOST_PLAN_NAMES: Record<string, DesiredFeature> = {
  [GAZEBO_PLAN_NAME]: 'pergola',
};
