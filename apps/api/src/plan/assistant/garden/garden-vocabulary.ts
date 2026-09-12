import {
  FeatureKindSchema,
  FeatureStatusSchema,
  GardenAnchorSchema,
  ZoneIdSchema,
} from '@garden-studio/schema';

/**
 * The closed sets the garden assistant may name, read off the Zod enums rather than retyped.
 *
 * Same reason as `vocabulary.ts`: two lists to keep in step would drift, and the failure would be
 * silent — the model returns a place the resolver has never heard of, `anchorPoint` falls to its
 * default, and the user sees a shed in the middle of the lawn with nothing explaining why.
 */
export const ZONE_IDS = ZoneIdSchema.options;
export const FEATURE_KINDS = FeatureKindSchema.options;
export const FEATURE_STATUSES = FeatureStatusSchema.options;
export const GARDEN_ANCHORS = GardenAnchorSchema.options;
