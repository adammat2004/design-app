import { ElementCategorySchema, MaterialIdSchema, ZoneIdSchema } from '@garden-studio/schema';

/**
 * The closed sets the model is allowed to name, read off the Zod enums rather than retyped.
 *
 * Retyping them into the JSON Schema would be two lists to keep in step, and the failure would be
 * silent: the model would happily return a material the planner then refuses, and the user would
 * see a change quietly dropped with no explanation.
 */
export const ZONE_IDS = ZoneIdSchema.options;
export const MATERIAL_IDS = MaterialIdSchema.options;
export const ELEMENT_CATEGORIES = ElementCategorySchema.options;
