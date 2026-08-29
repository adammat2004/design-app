import { z } from 'zod';
import { ConceptsSectionSchema, GeneratedConceptSchema, LayoutSectionSchema } from './concepts.js';
import { PlanDocumentSchema } from './document.js';
import { FeaturesSectionSchema } from './features.js';
import { GardenBriefSchema } from './brief.js';
import { SiteSectionSchema } from './site.js';
import { ValidationViolationSchema } from './validation.js';

/**
 * The wire contract for a stored plan.
 *
 * Writes are per-section rather than one whole-document PUT, because the wizard has one save
 * clock per screen and the layout section is far and away the biggest payload — a debounced
 * autosave on the map screen must not re-upload a generated garden every time a vertex moves.
 *
 * `revision` is the optimistic-concurrency token. Every write carries the revision it is based
 * on and the server bumps it, so two tabs editing the same section produce a 409 rather than a
 * silent lost update. The 409 body carries the server's current project, so the client can
 * adopt it instead of guessing.
 */

export const PlanProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  document: PlanDocumentSchema,
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlanProject = z.infer<typeof PlanProjectSchema>;

/** Enough for a project list without parsing the document. */
export const PlanProjectSummarySchema = PlanProjectSchema.omit({ document: true });
export type PlanProjectSummary = z.infer<typeof PlanProjectSummarySchema>;

export const CreatePlanProjectSchema = z.object({
  name: z.string().min(1).max(120).default('My garden'),
});
export type CreatePlanProject = z.infer<typeof CreatePlanProjectSchema>;

const revision = z.number().int().positive();

export const RenameProjectSchema = z.object({ revision, name: z.string().min(1).max(120) });
export type RenameProject = z.infer<typeof RenameProjectSchema>;

export const PatchSiteSchema = z.object({ revision, section: SiteSectionSchema });
export const PatchFeaturesSchema = z.object({ revision, section: FeaturesSectionSchema });
export const PatchBriefSchema = z.object({ revision, section: GardenBriefSchema });
export const PatchLayoutSchema = z.object({ revision, section: LayoutSectionSchema });

export type PatchSite = z.infer<typeof PatchSiteSchema>;
export type PatchFeatures = z.infer<typeof PatchFeaturesSchema>;
export type PatchBrief = z.infer<typeof PatchBriefSchema>;
export type PatchLayout = z.infer<typeof PatchLayoutSchema>;

/**
 * Step 4 writes only which concept is being looked at and which was chosen. The concepts array
 * itself is written by the generate endpoint alone, which keeps the largest payload in the
 * wizard from ever travelling client to server.
 */
export const PatchConceptSelectionSchema = z.object({
  revision,
  selectedId: ConceptsSectionSchema.shape.selectedId,
  chosenConceptId: ConceptsSectionSchema.shape.chosenConceptId,
});
export type PatchConceptSelection = z.infer<typeof PatchConceptSelectionSchema>;

/**
 * A section write returns the saved project *and* what is now wrong with it.
 *
 * Autosave persists the draft even when the geometry is invalid — a user can drag a boundary
 * vertex past a shed, and refusing that write would silently lose every edit after it. Continue
 * is gated on `violations` being empty, not on the save succeeding.
 */
export const SectionPatchResultSchema = z.object({
  project: PlanProjectSchema,
  violations: z.array(ValidationViolationSchema).default([]),
});
export type SectionPatchResult = z.infer<typeof SectionPatchResultSchema>;

export const ValidateDocumentSchema = z.object({ document: PlanDocumentSchema });
export type ValidateDocument = z.infer<typeof ValidateDocumentSchema>;

/** `all` rolls a fresh set of three; `one` regenerates a single slot in place. */
export const GenerateConceptsSchema = z.discriminatedUnion('mode', [
  z.object({ revision, mode: z.literal('all') }),
  z.object({ revision, mode: z.literal('one'), index: z.number().int().min(0).max(2) }),
]);
export type GenerateConcepts = z.infer<typeof GenerateConceptsSchema>;

export const GenerateConceptsResultSchema = z.object({
  project: PlanProjectSchema,
  concepts: z.array(GeneratedConceptSchema),
});
export type GenerateConceptsResult = z.infer<typeof GenerateConceptsResultSchema>;
