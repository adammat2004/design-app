import { z } from 'zod';
import { ExcludedFeatureSchema } from './design-brief.js';
import {
  BriefEmphasisSchema,
  BriefSlotSchema,
  GardenIntentSchema,
  LayoutArchetypeIdSchema,
} from './vocabulary.js';

/**
 * Why a concept is the way it is.
 *
 * Until now the only prose a concept carried was one of three fixed sentences from
 * `TEMPLATE_NAMES`, which described the *template* rather than this garden — the same words
 * whether the plan had a shed in the corner or no shed at all. A user comparing three plans could
 * see what was drawn and never why.
 *
 * A decision is recorded **where it is taken**, by the code that took it, and it names the elements
 * it is about. That is what keeps it honest: the explanation cannot claim the terrace was put at
 * the doors unless the pass that puts terraces at doors actually ran and produced an element to
 * point at. There is a test asserting every `subjects` id exists in the concept.
 *
 * This is data rather than a paragraph so the UI can render it as a list, a future card can show
 * three of them, and the eval harness can read what a concept claims to have done.
 */

export const DesignDecisionSchema = z.object({
  /**
   * A short machine key for the kind of decision — `terrace-at-doors`, `shed-by-gate`,
   * `lawn-continuous`, `feature-excluded`. Kebab case, and deliberately loose rather than an enum:
   * new passes add new kinds constantly and a closed list would make every one a schema change,
   * while nothing downstream branches on the value.
   */
  kind: z.string().max(60),
  /** The sentence a person reads. Measured, not asserted, wherever a number appears in it. */
  text: z.string().max(240),
  /** The element ids this decision is about, so the UI can highlight them on the plan. */
  subjects: z.array(z.string()).max(8).default([]),
});
export type DesignDecision = z.infer<typeof DesignDecisionSchema>;

export const ConceptExplanationSchema = z.object({
  strategy: LayoutArchetypeIdSchema,
  briefId: BriefSlotSchema,
  intent: GardenIntentSchema,
  emphasis: BriefEmphasisSchema,
  /** One paragraph: what this concept is trying to be, from the brief that produced it. */
  rationale: z.string().max(400).default(''),
  decisions: z.array(DesignDecisionSchema).max(24).default([]),
  /** What the brief asked for that this concept is not drawing, each with its reason. */
  excludedFeatures: z.array(ExcludedFeatureSchema).default([]),
  /** What the repair stage changed, in the order it changed it. Empty on a candidate that needed none. */
  repairs: z.array(z.string().max(200)).max(8).default([]),
});
export type ConceptExplanation = z.infer<typeof ConceptExplanationSchema>;

/**
 * Where a concept came from, so a regeneration, a test or a diversity check can name it.
 *
 * Today nothing on the wire says which template or archetype produced a concept — the template
 * survives only as a display name string, which is why every test that wants to identify a concept
 * matches on `name === 'Formal axis'`. That breaks the moment a name is reworded and cannot express
 * "these two concepts are the same shape of plan" at all.
 */
export const ConceptStrategySchema = z.object({
  briefId: BriefSlotSchema,
  archetype: LayoutArchetypeIdSchema,
  /** The candidate within the brief's pool that won, so a run can be reproduced exactly. */
  candidateId: z.string().max(80),
});
export type ConceptStrategy = z.infer<typeof ConceptStrategySchema>;
