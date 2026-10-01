import { z } from 'zod';

/**
 * Meshy's image-to-3D API, and the only place in `src/` that calls it.
 *
 * Plain `fetch`, for the reason `tools/assets/src/providers/openai.ts` gives: a handful of JSON calls,
 * and an SDK would be the SDK-shaped trap for no gain. `fetch` is injected so the tests never reach
 * the network — Meshy's free test-mode key has been retired, so a test that called Meshy would spend
 * real credits (see "Library models from Meshy" in CLAUDE.md).
 *
 * ## What is retried, and why the rest is not
 *
 * - **A 429 with `Retry-After`** is a rate limit and clears; waited for and retried.
 * - **A 429 without one** is Meshy's "too many queued tasks", which only clears when a task finishes.
 *   It is reported as `queue-full`, so the job stays `requested` and is submitted on a later poll.
 * - **A 5xx or a network failure on a GET** is retried with backoff: polling costs nothing.
 * - **A network failure on the POST that creates a task is never retried**: the request may have
 *   arrived, and a second would be a second task, charged. It is reported, and the job fails with a
 *   sentence saying to check the dashboard rather than guessing.
 * - **402** (no credits), **401** and every other 4xx fail at once: asking again changes nothing.
 */

export const MESHY_BASE = 'https://api.meshy.ai';

/** Every way a call can fail, as the job service needs to tell them apart. */
export type MeshyFailure =
  | 'rate-limited'
  | 'queue-full'
  | 'no-credits'
  | 'unauthorised'
  | 'rejected'
  | 'not-found'
  | 'conflict'
  | 'server'
  | 'network';

export class MeshyError extends Error {
  constructor(
    readonly failure: MeshyFailure,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MeshyError';
  }
}

/** The fields of a task the service reads; the rest is kept verbatim in the job's `task.json`. */
export const MeshyTaskSchema = z
  .object({
    id: z.string(),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED']),
    progress: z.number().default(0),
    model_urls: z.record(z.string().optional()).optional(),
    thumbnail_url: z.string().optional(),
    thumbnail_urls: z.record(z.string().optional()).optional(),
    consumed_credits: z.number().optional(),
    finished_at: z.number().optional(),
    expires_at: z.number().optional(),
    task_error: z.object({ message: z.string().optional() }).nullish(),
  })
  .passthrough();
export type MeshyTask = z.infer<typeof MeshyTaskSchema>;

/**
 * What every library model is asked for, as Phase 0 measured worked: remeshed, because Meshy 6 and
 * 7 do not remesh by default and the AR budget is 15k triangles; PBR; lighting removed so no baked
 * shadow fights the plan's sun; and `auto_size` off, because the size is ours to apply.
 */
export function imageTo3dRequest(imageDataUri: string, aiModel: string, triangleBudget: number) {
  return {
    image_url: imageDataUri,
    ai_model: aiModel,
    should_remesh: true,
    topology: 'triangle',
    target_polycount: triangleBudget,
    should_texture: true,
    enable_pbr: true,
    texture_resolution: '2k',
    remove_lighting: true,
    target_formats: ['glb'],
    multi_view_thumbnails: true,
    moderation: false,
  };
}

/** What the job service needs from Meshy — a `Pick` of the client, so a test can hand in a fake. */
export interface MeshyApi {
  createImageTo3d(body: ReturnType<typeof imageTo3dRequest>): Promise<string>;
  getImageTo3d(taskId: string): Promise<MeshyTask>;
  /** Deleting a `PENDING` task refunds it; an `IN_PROGRESS` one is refused with 409. */
  deleteImageTo3d(taskId: string): Promise<void>;
  balance(): Promise<number>;
  download(url: string, maxBytes: number): Promise<Buffer>;
}

type Fetch = typeof fetch;

export interface MeshyClientOptions {
  fetch?: Fetch;
  /** Waits between retries; a test passes one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const MAX_ATTEMPTS = 4;

export class MeshyClient implements MeshyApi {
  private readonly fetch: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    private readonly key: string,
    options: MeshyClientOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async createImageTo3d(body: ReturnType<typeof imageTo3dRequest>): Promise<string> {
    const created = await this.call<{ result: string }>('POST', '/openapi/v1/image-to-3d', body);
    return created.result;
  }

  async getImageTo3d(taskId: string): Promise<MeshyTask> {
    const task = await this.call<unknown>(
      'GET',
      `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
    );
    return MeshyTaskSchema.parse(task);
  }

  async deleteImageTo3d(taskId: string): Promise<void> {
    await this.call<unknown>('DELETE', `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`);
  }

  async balance(): Promise<number> {
    const { balance } = await this.call<{ balance: number }>('GET', '/openapi/v1/balance');
    return balance;
  }

  /** A result file, with a size ceiling so a surprise 400 MB mesh cannot fill the disk. */
  async download(url: string, maxBytes: number): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
    } catch (error) {
      throw new MeshyError('network', null, `Download failed: ${(error as Error).message}`);
    }
    if (!response.ok) {
      throw new MeshyError(
        response.status === 404 || response.status === 403 ? 'not-found' : 'server',
        response.status,
        `Download failed: ${response.status}`,
      );
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      throw new MeshyError(
        'rejected',
        null,
        `A ${declared}-byte file is over the ${maxBytes}-byte ceiling`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new MeshyError(
        'rejected',
        null,
        `A ${bytes.length}-byte file is over the ${maxBytes}-byte ceiling`,
      );
    }
    return bytes;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let last: MeshyError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetch(`${MESHY_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.key}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const failure = new MeshyError(
          'network',
          null,
          `Meshy could not be reached: ${(error as Error).message}`,
        );
        // The request may have arrived: a second POST would be a second task, charged.
        if (method === 'POST') throw failure;
        last = failure;
        await this.sleep(backoff(attempt));
        continue;
      }

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const message =
        messageOf(await response.text()) ?? `${response.status} ${response.statusText}`;
      const retryAfter = response.headers.get('retry-after');

      if (response.status === 429) {
        if (!retryAfter) throw new MeshyError('queue-full', 429, message);
        last = new MeshyError('rate-limited', 429, message);
        await this.sleep(Math.min(60_000, Number(retryAfter) * 1000 || backoff(attempt)));
        continue;
      }
      if (response.status >= 500) {
        const failure = new MeshyError('server', response.status, message);
        // A 5xx on a POST is ambiguous in the same way a dropped connection is.
        if (method === 'POST') throw failure;
        last = failure;
        await this.sleep(backoff(attempt));
        continue;
      }
      throw new MeshyError(failureOf(response.status), response.status, message);
    }
    throw last ?? new MeshyError('server', null, 'Meshy did not answer');
  }
}

function failureOf(status: number): MeshyFailure {
  if (status === 402) return 'no-credits';
  if (status === 401 || status === 403) return 'unauthorised';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  return 'rejected';
}

function messageOf(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return text ? text.slice(0, 300) : null;
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** (attempt - 1));
}
