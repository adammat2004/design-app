import {
  AssistantProposalSchema,
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  PlanProjectSummarySchema,
  SectionPatchResultSchema,
  ValidationResultSchema,
  ValidationViolationSchema,
  type AssistantProposal,
  type FeaturesSection,
  type GardenBrief,
  type GenerateConceptsResult,
  type LayoutSection,
  type PlanDocument,
  type PlanProject,
  type PlanProjectSummary,
  type SectionPatchResult,
  type SiteSection,
  type ValidationResult,
  type ValidationViolation,
} from '@garden-studio/schema';
import { z } from 'zod';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Thrown when the API rejects a request for breaking a spatial constraint. */
export class ValidationError extends Error {
  constructor(readonly violations: ValidationViolation[]) {
    super('The plan breaks one or more spatial constraints.');
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when the plan was written somewhere else since we last read it.
 *
 * Carries the server's current project so the caller can adopt it rather than guess — the
 * whole point of returning it in the 409 body.
 */
export class RevisionConflictError extends Error {
  constructor(readonly current: PlanProject) {
    super('This plan changed somewhere else.');
    this.name = 'RevisionConflictError';
  }
}

/**
 * Any other non-2xx response, carrying the status.
 *
 * The status matters to callers: the assistant reads 503 as "unavailable" and 429 as "too many
 * requests", and both need different copy from a generic failure.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ViolationBodySchema = z.object({ violations: z.array(ValidationViolationSchema) });
const ConflictBodySchema = z.object({ current: PlanProjectSchema });

/*
 * Generic over the schema rather than over its output type. Several of these schemas carry
 * `.default()`, so their input and output types differ, and a `z.ZodType<T>` parameter would
 * pin both to the same thing and reject them.
 */
async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<z.output<S>> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (response.status === 409) {
    const body = ConflictBodySchema.safeParse(await response.json().catch(() => null));
    if (body.success) throw new RevisionConflictError(body.data.current);
    throw new Error('This plan changed somewhere else.');
  }

  if (response.status === 422) {
    const body = ViolationBodySchema.safeParse(await response.json().catch(() => null));
    throw new ValidationError(body.success ? body.data.violations : []);
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Request to ${path} failed with ${response.status}.`);
  }

  // Parsed with the same schema the API validates against, so a drift between the two surfaces
  // here rather than as a confusing render bug.
  return schema.parse(await response.json());
}

export function createProject(name?: string): Promise<PlanProject> {
  return request('/plan-projects', PlanProjectSchema, {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
}

export function listProjects(): Promise<PlanProjectSummary[]> {
  return request('/plan-projects', z.array(PlanProjectSummarySchema));
}

export function getProject(id: string): Promise<PlanProject> {
  return request(`/plan-projects/${id}`, PlanProjectSchema, { cache: 'no-store' });
}

export function renameProject(id: string, revision: number, name: string): Promise<PlanProject> {
  return request(`/plan-projects/${id}`, PlanProjectSchema, {
    method: 'PATCH',
    body: JSON.stringify({ revision, name }),
  });
}

function patchSection(
  id: string,
  section: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<SectionPatchResult> {
  return request(`/plan-projects/${id}/${section}`, SectionPatchResultSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal,
  });
}

export function patchSite(
  id: string,
  revision: number,
  section: SiteSection,
): Promise<SectionPatchResult> {
  return patchSection(id, 'site', { revision, section });
}

export function patchFeatures(
  id: string,
  revision: number,
  section: FeaturesSection,
): Promise<SectionPatchResult> {
  return patchSection(id, 'features', { revision, section });
}

export function patchBrief(
  id: string,
  revision: number,
  section: GardenBrief,
): Promise<SectionPatchResult> {
  return patchSection(id, 'brief', { revision, section });
}

export function patchLayout(
  id: string,
  revision: number,
  section: LayoutSection,
): Promise<SectionPatchResult> {
  return patchSection(id, 'layout', { revision, section });
}

export function patchConceptSelection(
  id: string,
  revision: number,
  selectedId: string | null,
  chosenConceptId: string | null,
): Promise<SectionPatchResult> {
  return patchSection(id, 'concept-selection', { revision, selectedId, chosenConceptId });
}

/**
 * Generates concepts. Rejects with `ValidationError` when the stored plan has a spatial problem
 * the generator refuses to work around, and takes a signal because a real generation takes
 * seconds and a second click has to be able to cancel the first.
 */
export function generateConcepts(
  id: string,
  revision: number,
  input: { mode: 'all' } | { mode: 'one'; index: number },
  signal?: AbortSignal,
): Promise<GenerateConceptsResult> {
  return request(`/plan-projects/${id}/concepts/generate`, GenerateConceptsResultSchema, {
    method: 'POST',
    body: JSON.stringify({ revision, ...input }),
    signal,
  });
}

/**
 * Asks the assistant for a diff. Sends only the sentence — the server reads the plan it already
 * has, which is also what stops the assistant reasoning about a garden that is not the saved one.
 */
export function proposeChanges(
  id: string,
  message: string,
  signal?: AbortSignal,
): Promise<AssistantProposal> {
  return request(`/plan-projects/${id}/assistant/messages`, AssistantProposalSchema, {
    method: 'POST',
    body: JSON.stringify({ message }),
    signal,
  });
}

export function validateDocument(document: PlanDocument): Promise<ValidationResult> {
  return request('/plan-projects/validate', ValidationResultSchema, {
    method: 'POST',
    body: JSON.stringify({ document }),
  });
}
