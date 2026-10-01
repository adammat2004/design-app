import {
  ModelJobSchema,
  ModelLabStatusSchema,
  ModelReferenceSchema,
  ModelRequestResultSchema,
  type ModelGenerationRequest,
  type ModelJob,
  type ModelLabStatus,
  type ModelPublishRequest,
  type ModelReference,
  type ModelRequestResult,
} from '@garden-studio/schema';
import { z, type ZodTypeAny } from 'zod';
import { API_URL } from './plan-api';

/**
 * The model lab's calls to the API (`apps/api/src/model-assets`). Development only, like the page
 * that uses them; every answer is parsed with the shared schema, as `plan-api.ts` parses its own.
 */

/** A refusal the lab shows as it stands: the API's own sentence. */
export class ModelLabError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModelLabError';
  }
}

async function request<S extends ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const response = await fetch(`${API_URL}/model-assets${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join('; ');
    } catch {
      /* not JSON */
    }
    throw new ModelLabError(response.status, message);
  }
  return schema.parse(await response.json());
}

export const labStatus = (): Promise<ModelLabStatus> => request('/status', ModelLabStatusSchema);

export const labReferences = (): Promise<ModelReference[]> =>
  request('/references', z.array(ModelReferenceSchema));

export const labJobs = (): Promise<ModelJob[]> => request('/jobs', z.array(ModelJobSchema));

/** A job, which the API moves on a step before answering. */
export const labJob = (id: string): Promise<ModelJob> => request(`/jobs/${id}`, ModelJobSchema);

export const requestModel = (body: ModelGenerationRequest): Promise<ModelRequestResult> =>
  request('/requests', ModelRequestResultSchema, { method: 'POST', body: JSON.stringify(body) });

export const cancelJob = (id: string): Promise<ModelJob> =>
  request(`/jobs/${id}/cancel`, ModelJobSchema, { method: 'POST' });

export const rejectJob = (id: string): Promise<ModelJob> =>
  request(`/jobs/${id}/reject`, ModelJobSchema, { method: 'POST' });

export const publishJob = (id: string, body: ModelPublishRequest): Promise<ModelJob> =>
  request(`/jobs/${id}/publish`, ModelJobSchema, { method: 'POST', body: JSON.stringify(body) });

/** Where a job's file is served from: a thumbnail, Meshy's model, the processed one. */
export const jobFileUrl = (id: string, name: string): string =>
  `${API_URL}/model-assets/jobs/${id}/files/${name}`;

export const referenceImageUrl = (name: string): string =>
  `${API_URL}/model-assets/references/${name}/image`;
