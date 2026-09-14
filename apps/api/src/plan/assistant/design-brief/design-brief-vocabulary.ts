import {
  BriefEmphasisSchema,
  BriefSlotSchema,
  CirculationStyleSchema,
  DesiredFeatureSchema,
  FocalStrategySchema,
  FunctionalZoneTypeSchema,
  GardenIntentSchema,
  LayoutArchetypeIdSchema,
  PriorityTierSchema,
  PrivacyStrategySchema,
} from '@garden-studio/schema';

/**
 * The closed sets the strategic brief may name, read off the Zod enums rather than retyped.
 *
 * Same reason as `garden-vocabulary.ts`: two lists to keep in step would drift, and the failure is
 * silent in a particular way here — an archetype id the model invents parses as a string, fails the
 * Zod enum, and the whole envelope is thrown away for the deterministic brief with nothing on the
 * card to say a model was ever consulted.
 */
export const GARDEN_INTENTS = GardenIntentSchema.options;
export const PRIORITY_TIERS = PriorityTierSchema.options;
export const FUNCTIONAL_ZONES = FunctionalZoneTypeSchema.options;
export const LAYOUT_ARCHETYPES = LayoutArchetypeIdSchema.options;
export const CIRCULATION_STYLES = CirculationStyleSchema.options;
export const FOCAL_STRATEGIES = FocalStrategySchema.options;
export const PRIVACY_STRATEGIES = PrivacyStrategySchema.options;
export const BRIEF_EMPHASES = BriefEmphasisSchema.options;
export const BRIEF_SLOTS = BriefSlotSchema.options;
export const DESIRED_FEATURES = DesiredFeatureSchema.options;
