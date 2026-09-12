import { z } from 'zod';

/**
 * The spatial constraint contract, shared by the API's PostGIS validator and every screen that
 * reports a problem.
 *
 * Codes name what is wrong, not what to do about it; `section` names the step that can fix it,
 * so a violation raised while editing a layout can link the user back to the boundary they need
 * to widen.
 */

/*
 * There is deliberately no `feature_on_house` or `element_on_house`. Both existed, and both are
 * gone for the reason `geometryIsLegal` no longer consults the house: a patio attached to the
 * back wall is the ordinary case rather than a mistake, and the house is drawn over whatever
 * runs under it. The house itself still may not cross the fence — `house_outside_boundary`.
 */
export const ViolationCodeSchema = z.enum([
  /** Fewer than three vertices, or the ring was never closed. */
  'boundary_not_closed',
  /** The outline crosses itself. */
  'invalid_boundary',
  'house_outside_boundary',
  /**
   * The custom redesign area crosses itself, is a sliver, or leaves the property.
   *
   * Reported rather than absorbed. `scopeRing` refuses an unusable ring, and refusing it silently
   * would turn "design only this corner" into "design the whole plot" with nothing on screen to
   * say so — the one outcome worse than either answer.
   */
  'invalid_scope_polygon',
  'feature_outside_boundary',
  'features_overlap',
  'element_outside_boundary',
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
