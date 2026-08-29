import { z } from 'zod';

/**
 * The spatial constraint contract, shared by the API's PostGIS validator and every screen that
 * reports a problem.
 *
 * Codes name what is wrong, not what to do about it; `section` names the step that can fix it,
 * so a violation raised while editing a layout can link the user back to the boundary they need
 * to widen.
 */

export const ViolationCodeSchema = z.enum([
  /** Fewer than three vertices, or the ring was never closed. */
  'boundary_not_closed',
  /** The outline crosses itself. */
  'invalid_boundary',
  'house_outside_boundary',
  'feature_outside_boundary',
  'feature_on_house',
  'features_overlap',
  'element_outside_boundary',
  'element_on_house',
]);
export type ViolationCode = z.infer<typeof ViolationCodeSchema>;

export const ViolationSectionSchema = z.enum(['site', 'features', 'layout']);
export type ViolationSection = z.infer<typeof ViolationSectionSchema>;

export const ValidationViolationSchema = z.object({
  code: ViolationCodeSchema,
  /**
   * What is implicated — features, layout elements, or nothing at all for a boundary-level
   * code. Two entries for an overlap.
   */
  targetIds: z.array(z.string()).default([]),
  /** Which step can fix it, so the UI can offer a way back there. */
  section: ViolationSectionSchema,
  message: z.string(),
});
export type ValidationViolation = z.infer<typeof ValidationViolationSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  violations: z.array(ValidationViolationSchema).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
