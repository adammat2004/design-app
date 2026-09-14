import { z } from 'zod';
import { DesiredFeatureSchema, type DesiredFeature, StyleDirectionSchema } from '../brief.js';
import {
  BriefEmphasisSchema,
  BriefSlotSchema,
  CirculationStyleSchema,
  FocalStrategySchema,
  FunctionalZoneTypeSchema,
  GardenIntentSchema,
  isAtLeast,
  LayoutArchetypeIdSchema,
  PriorityTierSchema,
  PrivacyStrategySchema,
  type PriorityTier,
} from './vocabulary.js';

/**
 * The strategic decisions for one concept, taken before a single coordinate exists.
 *
 * This is the seam the whole design agent turns on. The geometry engine consumes a `DesignBrief`,
 * never the raw brief: "the user ticked pergola" becomes "the dining zone is secondary, the pergola
 * is preferred within it, and the layout is a terrace-and-lawn read on a wide plot". Everything
 * downstream — zone planning, archetype choice, candidate enumeration, scoring — reads this.
 *
 * **There is no field here that can hold a coordinate**, and that is the design rather than an
 * oversight. It is the same property `DesignIntent` has in `assistant.ts`, for the same reason: a
 * model may eventually write one of these, and a model must never be able to say *where* something
 * goes. Positions exist only as strategies (`focal`, `circulation`, `privacy`) and as zone types,
 * which the deterministic planner resolves against real geometry. There is a test walking the
 * schema's property names to keep it that way.
 *
 * Three of these are built per generation — one per concept slot — so the three concepts differ on
 * what they are *for* rather than on which template happened to be third in the list.
 */

export const FeaturePrioritySchema = z.object({
  feature: DesiredFeatureSchema,
  tier: PriorityTierSchema,
  /** Why it sits at that tier, in the concept's own words. Shown in the explanation. */
  reason: z.string().max(160),
});
export type FeaturePriority = z.infer<typeof FeaturePrioritySchema>;

/**
 * Something the brief asked for that this concept is deliberately not drawing.
 *
 * A reason is required rather than optional: "the pond is missing" and "there was no room for the
 * pond without losing the lawn" are different answers, and only the second is a design decision.
 * The whole point of allowing a concept to exclude a feature is that it says so.
 */
export const ExcludedFeatureSchema = z.object({
  feature: DesiredFeatureSchema,
  reason: z.string().max(200),
});
export type ExcludedFeature = z.infer<typeof ExcludedFeatureSchema>;

export const DesignBriefSchema = z.object({
  /** Which concept slot this brief fills. `A` is the intent-led recommendation. */
  id: BriefSlotSchema,
  intent: GardenIntentSchema,
  emphasis: BriefEmphasisSchema,
  /** The room the whole plan is organised around. Exactly one. */
  primaryZone: FunctionalZoneTypeSchema,
  secondaryZones: z.array(FunctionalZoneTypeSchema).max(4).default([]),
  supportingZones: z.array(FunctionalZoneTypeSchema).max(6).default([]),
  /**
   * The archetypes worth trying for this brief, best first. A shortlist rather than one choice,
   * because the candidate loop scores what the site actually allows — an archetype that suits the
   * brief perfectly and the plot not at all should lose to the one that fits.
   */
  archetypeShortlist: z.array(LayoutArchetypeIdSchema).min(1).max(3),
  circulation: CirculationStyleSchema,
  focal: FocalStrategySchema,
  privacy: PrivacyStrategySchema,
  featurePriorities: z.array(FeaturePrioritySchema).default([]),
  excludedFeatures: z.array(ExcludedFeatureSchema).default([]),
  style: StyleDirectionSchema.nullable().default(null),
  /** One paragraph saying what this concept is trying to be. Deterministic, or model-written. */
  rationale: z.string().max(400).default(''),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

/**
 * What a model returns when it writes the three briefs.
 *
 * Shaped like `AssistantIntentEnvelopeSchema`: the payload plus a sentence of prose, so the same
 * `parse` → `safeParse` → reconcile pipeline applies. `notes` is never shown on its own; it is what
 * the model says about the set, and the per-brief `rationale` is what a card could show.
 */
export const DesignBriefEnvelopeSchema = z.object({
  briefs: z.array(DesignBriefSchema).length(3),
  notes: z.string().max(600).default(''),
});
export type DesignBriefEnvelope = z.infer<typeof DesignBriefEnvelopeSchema>;

/** The tier a feature sits at in this brief, or `null` when the brief never mentions it. */
export function tierOf(brief: DesignBrief, feature: DesiredFeature): PriorityTier | null {
  return brief.featurePriorities.find((entry) => entry.feature === feature)?.tier ?? null;
}

/** Every feature at or above a tier, in the order the brief ranked them. */
export function featuresAtLeast(brief: DesignBrief, floor: PriorityTier): DesiredFeature[] {
  return brief.featurePriorities
    .filter((entry) => isAtLeast(entry.tier, floor))
    .map((entry) => entry.feature);
}
