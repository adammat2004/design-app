import {
  AssistantAvailabilitySchema,
  AssistantProposalSchema,
  RepairDesignResultSchema,
  ReviewDesignResultSchema,
  RedesignResultSchema,
  type AssistantAvailability,
  type AssistantTurn,
  type DesignElement,
  type DesignIntent,
  type DesignIssue,
  type RedesignResult,
  type RepairDesignResult,
  type ReviewDesignResult,
  GardenProposalSchema,
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  PlanProjectSummarySchema,
  RecordDesignEventsResultSchema,
  SectionPatchResultSchema,
  ValidationResultSchema,
  ValidationViolationSchema,
  type AssistantProposal,
  type DesignEvent,
  type GardenProposal,
  type FeaturesSection,
  type GardenBrief,
  type GenerateConceptsResult,
  type LayoutSection,
  type PlanDocument,
  type PlanProject,
  type PlanProjectSummary,
  type RecordDesignEventsResult,
  type SectionPatchResult,
  type SiteSection,
  type ValidationResult,
  type ValidationViolation,
} from '@garden-studio/schema';
import { z } from 'zod';

/**
 * Where the API lives.
 *
 * Exported because the "cannot reach the API" screen names the address it tried — a message that
 * says a server is unreachable without saying which one leaves the reader no better off.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
 * Asks the designer what to do about a sentence.
 *
 * Sends the sentence and the last few turns, and nothing about the garden — the server reads the
 * plan it already has, which is what stops the designer reasoning about a garden that is not the
 * saved one. The history is the exception and it is not about the garden: without it "a bit more"
 * refers to nothing.
 */
export function proposeChanges(
  id: string,
  message: string,
  history: AssistantTurn[] = [],
  signal?: AbortSignal,
): Promise<AssistantProposal> {
  return request(`/plan-projects/${id}/assistant/messages`, AssistantProposalSchema, {
    method: 'POST',
    body: JSON.stringify({ message, history }),
    signal,
  });
}

/**
 * Whether this server can interpret a sentence at all.
 *
 * Asked once when the editor opens so the panel can say the designer needs a key *before* somebody
 * types a request and waits for it to fail. Not a project route: whether a key is configured is a
 * fact about the server.
 */
export function assistantAvailability(signal?: AbortSignal): Promise<AssistantAvailability> {
  return request('/plan-projects/assistant/availability', AssistantAvailabilitySchema, { signal });
}

/**
 * Asks what is wrong with a layout. Writes nothing, and takes the elements rather than reading
 * the stored plan — the question is asked mid-redesign, about a garden saved nowhere yet.
 */
export function reviewDesign(
  id: string,
  elements: DesignElement[],
  signal?: AbortSignal,
): Promise<ReviewDesignResult> {
  return request(`/plan-projects/${id}/design/review`, ReviewDesignResultSchema, {
    method: 'POST',
    body: JSON.stringify({ elements }),
    signal,
  });
}

/**
 * Asks for the best correction to one fault, measured rather than guessed.
 *
 * The difference from `requestRedesign` is what is being asked. That takes intents and answers with
 * what they come to; this takes a *fault* and answers with the best legal change to it, having
 * scored several. What it buys the loop is the thing the loop could not do: when nothing helps, the
 * user is not shown a change being made and then taken back.
 */
export function repairDesign(
  id: string,
  issue: DesignIssue,
  elements: DesignElement[],
  signal?: AbortSignal,
): Promise<RepairDesignResult> {
  return request(`/plan-projects/${id}/design/repair`, RepairDesignResultSchema, {
    method: 'POST',
    body: JSON.stringify({ issue, elements }),
    signal,
  });
}

/**
 * Asks the planner for a diff directly, in intents rather than in a sentence.
 *
 * No model, so no key, no rate limit and nothing that can fail for reasons outside this machine —
 * which is what lets the design reviewer's corrections work on a server that has never had an
 * Anthropic key.
 */
export function requestRedesign(
  id: string,
  intents: DesignIntent[],
  elements: DesignElement[],
  signal?: AbortSignal,
): Promise<RedesignResult> {
  return request(`/plan-projects/${id}/assistant/redesign`, RedesignResultSchema, {
    method: 'POST',
    body: JSON.stringify({ intents, elements }),
    signal,
  });
}

/**
 * Asks the garden assistant to record what the user has described. Sends only the sentence, for
 * the same reason `proposeChanges` does.
 */
export function proposeGardenChanges(
  id: string,
  message: string,
  signal?: AbortSignal,
): Promise<GardenProposal> {
  return request(`/plan-projects/${id}/assistant/garden`, GardenProposalSchema, {
    method: 'POST',
    body: JSON.stringify({ message }),
    signal,
  });
}

/**
 * Records what the user did with the design they were offered.
 *
 * A batch, and the only call in this client a caller is expected to ignore. Everything else here
 * either answers a question the screen is waiting on or reports a failure it has to show; this one
 * exists so the generator can be measured from outside itself, and a user must never wait on it,
 * see it fail, or have an editor action broken by it. `recordDesignEvents` in `state/design-events`
 * is what callers actually use — it swallows the rejection this can still produce.
 */
export function recordDesignEvents(
  id: string,
  events: DesignEvent[],
): Promise<RecordDesignEventsResult> {
  return request(`/plan-projects/${id}/events`, RecordDesignEventsResultSchema, {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}

export function validateDocument(document: PlanDocument): Promise<ValidationResult> {
  return request('/plan-projects/validate', ValidationResultSchema, {
    method: 'POST',
    body: JSON.stringify({ document }),
  });
}
