import { z } from 'zod';

/**
 * The words the design agent thinks in.
 *
 * A leaf module: it imports nothing of ours, for the same reason `zone-id.ts` and `opening.ts`
 * are leaves. The knowledge tables in `apps/api` are keyed by these enums and a model's structured
 * output is validated against them, so both halves have to read the same list or the two drift
 * silently — a brief naming an archetype the selector has never heard of parses and then designs
 * nothing.
 *
 * Deliberately **not** the same vocabulary as the plan's own. `ZoneId` (front/back/left/right) is
 * where a piece of ground *is*; `FunctionalZoneType` is what it is *for*, and a garden has several
 * of the latter inside one of the former. `DesignIntent` is the step-5 assistant's edit union and
 * has nothing to do with `GardenIntent`, which is what the garden is for.
 */

/**
 * What the garden is primarily for, inferred from the brief rather than asked.
 *
 * One value, not a set: the point of an intent is that it *orders* everything else — which zone is
 * primary, which features are essential, which archetype is recommended. A garden that is equally
 * four things is `mixed`, and `mixed` is an honest answer rather than a failure to decide.
 */
export const GardenIntentSchema = z.enum([
  'entertaining',
  'family',
  'relaxation',
  'gardening',
  'lowMaintenance',
  'showcase',
  'mixed',
]);
export type GardenIntent = z.infer<typeof GardenIntentSchema>;

/**
 * How badly a feature is wanted.
 *
 * The whole reason this exists: `featureAttempts` used to cut the requested list in *brief order*,
 * so a fire pit ticked before a terrace could displace it. An essential is one the concept is not
 * worth offering without; a preferred one is dropped before the design is compromised; an optional
 * one is there if it fits.
 */
export const PriorityTierSchema = z.enum(['essential', 'preferred', 'optional']);
export type PriorityTier = z.infer<typeof PriorityTierSchema>;

/** Ascending importance, so "at least preferred" is a comparison. */
export const PRIORITY_ORDER: PriorityTier[] = ['optional', 'preferred', 'essential'];

export function isAtLeast(tier: PriorityTier, floor: PriorityTier): boolean {
  return PRIORITY_ORDER.indexOf(tier) >= PRIORITY_ORDER.indexOf(floor);
}

/**
 * A room in the garden — what a part of it is for, as opposed to what stands in it.
 *
 * A zone is not a feature: the dining zone holds the terrace, the pergola, the table and the
 * planting round them, and it is the zone that gets positioned. Features are then placed inside
 * the zone that claims them.
 */
export const FunctionalZoneTypeSchema = z.enum([
  'terrace',
  'dining',
  'lounge',
  'play',
  'lawn',
  'utility',
  'productive',
  'planting',
  'water',
  'destination',
  'transition',
  'arrival',
  'passage',
]);
export type FunctionalZoneType = z.infer<typeof FunctionalZoneTypeSchema>;

/** How much of the design a zone is. Exactly one zone in a plan is `primary`. */
export const ZoneImportanceSchema = z.enum(['primary', 'secondary', 'supporting']);
export type ZoneImportance = z.infer<typeof ZoneImportanceSchema>;

/**
 * The composition patterns a garden can be laid out on.
 *
 * The first three are what the three layout templates already are, named for the composition
 * rather than for the file: `terrace_and_lawn` is `rectilinear`, `sweeping_lawn` is `curved`,
 * `formal_axis` is `formal`. The rest are the shapes those three cannot express — a wide shallow
 * plot laid out along the wall, a long one as a sequence of rooms, a courtyard with no lawn at all,
 * and a garden whose point is the place at the far end.
 */
export const LayoutArchetypeIdSchema = z.enum([
  'terrace_and_lawn',
  'sweeping_lawn',
  'formal_axis',
  'side_by_side',
  'linear_sequence',
  'courtyard',
  'destination_garden',
]);
export type LayoutArchetypeId = z.infer<typeof LayoutArchetypeIdSchema>;

/** How you get round the garden: straight to it, round the edge, down the middle, or wandering. */
export const CirculationStyleSchema = z.enum(['direct', 'perimeter', 'axis', 'meander']);
export type CirculationStyle = z.infer<typeof CirculationStyleSchema>;

/** What the eye is meant to land on from the doors, and `none` when nothing is claimed. */
export const FocalStrategySchema = z.enum(['axis-end', 'far-corner', 'water', 'none']);
export type FocalStrategy = z.infer<typeof FocalStrategySchema>;

/** What the planting and structures are asked to screen. */
export const PrivacyStrategySchema = z.enum([
  'screen-street',
  'screen-neighbours',
  'enclose',
  'none',
]);
export type PrivacyStrategy = z.infer<typeof PrivacyStrategySchema>;

/**
 * Which way a concept leans, and therefore how it differs from the other two.
 *
 * This replaces the archetype *slot* as the axis of difference on the brief: three concepts are
 * three readings of one brief, and a reading is "this one is the social answer" rather than "this
 * one is slot 2". Budget position and upkeep follow from it.
 */
export const BriefEmphasisSchema = z.enum(['social', 'open', 'planted', 'productive']);
export type BriefEmphasis = z.infer<typeof BriefEmphasisSchema>;

/** Which of the three slots a brief fills. Slot A is always the intent-led recommendation. */
export const BriefSlotSchema = z.enum(['A', 'B', 'C']);
export type BriefSlot = z.infer<typeof BriefSlotSchema>;

/**
 * The shape of the plot, as it bears on which archetype can work.
 *
 * Measured on the room the garden is composed in rather than on the plot: what matters is the
 * proportions of the space behind the doors, not of the title deeds.
 */
export const SiteShapeSchema = z.enum(['wide', 'long', 'square', 'irregular', 'courtyard']);
export type SiteShape = z.infer<typeof SiteShapeSchema>;
