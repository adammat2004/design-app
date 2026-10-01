import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { createIO } from '@garden-studio/model-pipeline';
import { canonicalSpec, specForPreset, type ModelGenerationRequest } from '@garden-studio/schema';
import { HttpException } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { modelGenerationJobs } from '../db/schema.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE } from '../test/db.js';
import { admission, type ModelAssetsConfig } from './model-assets.config.js';
import { readLibrary } from './model-library.writer.js';
import { ModelJobsService } from './model-jobs.service.js';
import { MeshyError, type MeshyApi, type MeshyTask } from './meshy.client.js';

/*
 * The job lifecycle against real Postgres and a scripted Meshy. Nothing here reaches Meshy — its
 * free test key has been retired, so a test that did would spend real credits — and nothing writes
 * to the real library or storage: both are temporary folders.
 */

const connection = await connectTestDatabase();

/** A 1 × 1 PNG: a valid picture to upload, and Meshy's thumbnails. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const UPLOAD = `data:image/png;base64,${PNG.toString('base64')}`;

/** A box GLB of the given size, standing where Meshy stands things: centred on its box. */
async function boxGlb(options: { metallicNoMap?: boolean } = {}): Promise<Buffer> {
  const document = new Document();
  const buffer = document.createBuffer();
  const p: number[] = [];
  for (let i = 0; i < 8; i += 1)
    p.push(i & 1 ? 0.95 : -0.95, (i >> 1) & 1 ? 0.9 : -0.9, (i >> 2) & 1 ? 0.95 : -0.95);
  const primitive = document
    .createPrimitive()
    .setAttribute(
      'POSITION',
      document.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(
          new Uint16Array([
            0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4,
            6, 1, 3, 5, 3, 7, 5,
          ]),
        )
        .setBuffer(buffer),
    );
  if (options.metallicNoMap)
    primitive.setMaterial(document.createMaterial('m').setMetallicFactor(1));
  document
    .createScene('s')
    .addChild(document.createNode('n').setMesh(document.createMesh('m').addPrimitive(primitive)));
  return Buffer.from(await (await createIO()).writeBinary(document));
}

/** Meshy as a script: what each call answers, and a count of what was asked. */
class FakeMeshy implements MeshyApi {
  created = 0;
  glbDownloads = 0;
  deleted: string[] = [];
  balanceValue = 1000;
  createFails: Error[] = [];
  polls: Partial<MeshyTask>[] = [];
  downloadFails: Error[] = [];
  glb: Buffer = Buffer.alloc(0);
  createDelay = 0;

  async createImageTo3d(): Promise<string> {
    if (this.createDelay) await new Promise((done) => setTimeout(done, this.createDelay));
    const failure = this.createFails.shift();
    if (failure) throw failure;
    this.created += 1;
    return `task-${randomUUID()}`;
  }

  async getImageTo3d(taskId: string): Promise<MeshyTask> {
    const next = this.polls.shift() ?? {};
    return {
      id: taskId,
      status: 'SUCCEEDED',
      progress: 100,
      model_urls: { glb: 'https://assets.meshy.ai/t/model.glb?Expires=1' },
      thumbnail_url: 'https://assets.meshy.ai/t/preview.png?Expires=1',
      thumbnail_urls: { front: 'https://assets.meshy.ai/t/front.png?Expires=1' },
      consumed_credits: 30,
      expires_at: Date.now() + 72 * 3600_000,
      ...next,
    } as MeshyTask;
  }

  async deleteImageTo3d(taskId: string): Promise<void> {
    this.deleted.push(taskId);
  }

  async balance(): Promise<number> {
    return this.balanceValue;
  }

  async download(url: string): Promise<Buffer> {
    const failure = this.downloadFails.shift();
    if (failure) throw failure;
    if (url.includes('.glb')) {
      this.glbDownloads += 1;
      return this.glb;
    }
    return PNG;
  }
}

describe.skipIf(!connection)('ModelJobsService', () => {
  if (!connection) {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
    return;
  }
  const { db } = connection;
  const created: string[] = [];
  const roots: string[] = [];
  let glb: Buffer;

  beforeAll(async () => {
    glb = await boxGlb();
  });

  afterEach(async () => {
    if (created.length)
      await db
        .delete(modelGenerationJobs)
        .where(inArray(modelGenerationJobs.id, created.splice(0)));
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await connection.close();
  });

  function setup(over: Partial<ModelAssetsConfig> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'model-jobs-'));
    roots.push(root);
    const config: ModelAssetsConfig = {
      enabled: true,
      reason: null,
      aiModel: 'meshy-7.1',
      ceiling: 1_000_000,
      minBalance: 60,
      maxInFlight: 1_000,
      storageDir: join(root, 'storage'),
      publicDir: join(root, 'public'),
      referencesDir: join(root, 'references'),
      pollIntervalMs: 0,
      staleAfterMs: 60_000,
      ...over,
    };
    const meshy = new FakeMeshy();
    meshy.glb = glb;
    const service = new ModelJobsService(db, meshy, config, { sweepOnBoot: false });
    return { service, meshy, config };
  }

  /** A request whose spec no other test shares, so the one-live-job-per-spec rule never collides. */
  function body(over: Partial<ModelGenerationRequest> = {}): ModelGenerationRequest {
    return {
      symbol: 'gazebo',
      preset: 'classic',
      notes: `test ${randomUUID()}`,
      reference: { kind: 'upload', dataUrl: UPLOAD },
      force: false,
      ...over,
    };
  }

  async function ask(service: ModelJobsService, request = body()) {
    const result = await service.request(request);
    /*
     * Only a job this test made is removed afterwards — never one it merely found. The suite shares
     * the dev database, and the first version also removed `existing` jobs: a test that matched a
     * real job waiting in review deleted its row.
     */
    if (result.kind === 'created') created.push(result.job.id);
    return result;
  }

  async function status(id: string) {
    const [row] = await db
      .select()
      .from(modelGenerationJobs)
      .where(inArray(modelGenerationJobs.id, [id]));
    return row!;
  }

  it('takes a request to review, publishes it to the library, and then reuses it', async () => {
    const { service, meshy, config } = setup();
    const request = body();
    const first = await ask(service, request);
    expect(first.kind).toBe('created');
    const id = first.kind === 'created' ? first.job.id : '';
    expect((await status(id)).status).toBe('submitted');
    expect(meshy.created).toBe(1);

    // One poll: Meshy says it has finished, so it is downloaded and processed in the same call.
    const job = await service.get(id);
    expect(job.status).toBe('review');
    expect(job.credits).toBe(30);
    expect(job.files).toEqual(
      expect.arrayContaining(['model.glb', 'processed.glb', 'reference.png', 'thumb.png']),
    );
    expect(job.result?.defects).toEqual([]);
    expect(job.result?.naturalSize[0]).toBeCloseTo(3, 2);
    // The signed URLs are not kept.
    expect(readFileSync(join(config.storageDir, 'jobs', id, 'task.json'), 'utf8')).not.toContain(
      'Expires=',
    );

    const published = await service.publish(id, {
      assetId: `test-gazebo-${id.slice(0, 8)}`,
      frontYawDeg: 0,
      turnable: true,
      fitHeight: false,
    });
    expect(published.status).toBe('approved');
    const library = readLibrary(config);
    expect(library.entries.map((entry) => entry.id)).toEqual([`test-gazebo-${id.slice(0, 8)}`]);
    expect(
      existsSync(join(config.publicDir, 'models', 'library', `test-gazebo-${id.slice(0, 8)}.glb`)),
    ).toBe(true);
    expect(
      existsSync(
        join(config.publicDir, 'models', 'references', `test-gazebo-${id.slice(0, 8)}.webp`),
      ),
    ).toBe(true);

    // Asked again for the same thing, nothing is spent.
    expect(await service.request(request)).toEqual({
      kind: 'reused',
      assetId: `test-gazebo-${id.slice(0, 8)}`,
    });
    expect(meshy.created).toBe(1);
  });

  it('finds the live job for a spec instead of paying twice, even when asked at the same instant', async () => {
    const { service, meshy } = setup();
    meshy.createDelay = 50;
    const request = body();
    const [a, b] = await Promise.all([ask(service, request), ask(service, request)]);
    expect([a.kind, b.kind].sort()).toEqual(['created', 'existing']);
    expect(meshy.created).toBe(1);
    const again = await ask(service, request);
    expect(again.kind).toBe('existing');
    expect(meshy.created).toBe(1);
  });

  it('submits once however many polls race for it', async () => {
    const { service, meshy } = setup();
    meshy.createFails.push(new MeshyError('queue-full', 429, 'NoMorePendingTasks'));
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    // Meshy's queue was full: still requested, waiting for a later poll.
    expect((await status(id)).status).toBe('requested');
    meshy.createDelay = 30;
    await Promise.all([service.advance(id), service.advance(id), service.advance(id)]);
    expect(meshy.created).toBe(1);
    expect((await status(id)).status).toBe('submitted');
  });

  it('downloads once however many polls see it finish', async () => {
    const { service, meshy } = setup();
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    await Promise.all([service.get(id), service.get(id), service.get(id)]);
    expect(meshy.glbDownloads).toBe(1);
    expect((await status(id)).status).toBe('review');
  });

  it('refuses at the ceiling, at the in-flight limit, and below the minimum balance', async () => {
    const capped = setup({ ceiling: 1 });
    await expect(capped.service.request(body())).rejects.toBeInstanceOf(HttpException);
    expect(capped.meshy.created).toBe(0);

    const busy = setup({ maxInFlight: 0 as unknown as number });
    await expect(busy.service.request(body())).rejects.toThrow(/already being made/);

    const poor = setup();
    poor.meshy.balanceValue = 10;
    const result = await ask(poor.service);
    const row = await status(result.kind === 'created' ? result.job.id : '');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/under MESHY_MIN_BALANCE/);
    expect(poor.meshy.created).toBe(0);
  });

  it('fails plainly on no credits, and never guesses whether a dropped submission arrived', async () => {
    const broke = setup();
    broke.meshy.createFails.push(new MeshyError('no-credits', 402, 'Payment required'));
    const a = await ask(broke.service);
    expect((await status(a.kind === 'created' ? a.job.id : '')).error).toMatch(/no credits/);

    const dropped = setup();
    dropped.meshy.createFails.push(new MeshyError('network', null, 'fetch failed'));
    const b = await ask(dropped.service);
    const row = await status(b.kind === 'created' ? b.job.id : '');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/may or may not have received/);
  });

  it('tries a failed Meshy task once more for free, and then reports it', async () => {
    const { service, meshy } = setup();
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    meshy.polls.push({ status: 'FAILED', task_error: { message: 'Generation failed' } });
    await service.get(id);
    expect(meshy.created).toBe(2);
    expect((await status(id)).status).toBe('submitted');
    meshy.polls.push({ status: 'FAILED', task_error: { message: 'Generation failed' } });
    const failed = await service.get(id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Generation failed');
    expect(meshy.created).toBe(2);
  });

  it('retries a failed download, but says when Meshy has deleted the result', async () => {
    const { service, meshy } = setup();
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    meshy.downloadFails.push(new MeshyError('server', 503, 'busy'));
    expect((await service.get(id)).status).toBe('generating');
    expect((await service.get(id)).status).toBe('review');

    const second = await ask(service);
    const late = second.kind === 'created' ? second.job.id : '';
    meshy.polls.push({ expires_at: Date.now() - 1000 });
    meshy.downloadFails.push(new MeshyError('not-found', 404, 'gone'));
    const expired = await service.get(late);
    expect(expired.status).toBe('failed');
    expect(expired.error).toMatch(/three days/);
  });

  it('recovers at boot what a restart interrupted', async () => {
    const { service, meshy } = setup({ staleAfterMs: 1000 });
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    // As if the process died mid-download an hour ago.
    await db
      .update(modelGenerationJobs)
      .set({ status: 'downloading', updatedAt: sql`now() - interval '1 hour'` })
      .where(inArray(modelGenerationJobs.id, [id]));
    await service.sweep();
    expect((await status(id)).status).toBe('review');
    expect(meshy.glbDownloads).toBe(1);

    const other = await ask(service);
    const lost = other.kind === 'created' ? other.job.id : '';
    await db
      .update(modelGenerationJobs)
      .set({ status: 'submitting', updatedAt: sql`now() - interval '1 hour'` })
      .where(inArray(modelGenerationJobs.id, [lost]));
    await service.sweep();
    const row = await status(lost);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/Check the Meshy dashboard/);
  });

  it('cancels a task Meshy has not started, and refuses one it has', async () => {
    const { service, meshy } = setup();
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    const cancelled = await service.cancel(id);
    expect(cancelled.status).toBe('cancelled');
    expect(meshy.deleted).toHaveLength(1);

    const second = await ask(service);
    const running = second.kind === 'created' ? second.job.id : '';
    meshy.polls.push({ status: 'IN_PROGRESS', progress: 40 });
    expect((await service.get(running)).progress).toBe(40);
    await expect(service.cancel(running)).rejects.toThrow(/started it/);
  });

  it('stretches it upright to the spec’s height when the reviewer asks, and records how far', async () => {
    const { service, config } = setup();
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    const job = await service.get(id);
    // The test box is 1.9 × 1.8 × 1.9, so contained in 3 × 3 it stands 2.84 m: 1% off 2.8.
    expect(job.result?.heightStretch).toBe(1);
    const published = await service.publish(id, {
      assetId: `fitted-${id.slice(0, 8)}`,
      frontYawDeg: 0,
      turnable: false,
      fitHeight: true,
    });
    expect(published.status).toBe('approved');
    expect(published.result?.naturalSize[1]).toBeCloseTo(2.8, 3);
    const entry = readLibrary(config).entries[0]!;
    expect(entry.naturalSize[1]).toBeCloseTo(2.8, 3);
    expect(entry.heightStretch).toBeCloseTo(2.8 / 2.8421, 3);
  });

  it('refuses to publish a defect, or under an id already published', async () => {
    const { service, meshy } = setup();
    meshy.glb = await boxGlb({ metallicNoMap: true });
    const result = await ask(service);
    const id = result.kind === 'created' ? result.job.id : '';
    const job = await service.get(id);
    expect(job.result?.defects.join(' ')).toMatch(/polished metal/);
    await expect(
      service.publish(id, {
        assetId: 'metal-gazebo',
        frontYawDeg: 0,
        turnable: false,
        fitHeight: false,
      }),
    ).rejects.toThrow(/Not publishable/);
    expect((await service.reject(id)).status).toBe('rejected');

    meshy.glb = glb;
    const a = await ask(service);
    const b = await ask(service);
    const first = a.kind === 'created' ? a.job.id : '';
    const second = b.kind === 'created' ? b.job.id : '';
    await service.get(first);
    await service.get(second);
    await service.publish(first, {
      assetId: 'twin',
      frontYawDeg: 0,
      turnable: false,
      fitHeight: false,
    });
    await expect(
      service.publish(second, {
        assetId: 'twin',
        frontYawDeg: 0,
        turnable: false,
        fitHeight: false,
      }),
    ).rejects.toThrow(/already published/);
    expect((await status(second)).status).toBe('review');
  });

  it('only takes a generated reference drawn for the very spec asked for', async () => {
    const { service, config } = setup();
    // Its own notes, so a real job for a plain modern gazebo in the dev database is not found first.
    const notes = `reference ${randomUUID()}`;
    const drawnFor = specForPreset('gazebo', 'modern', { notes });
    mkdirSync(config.referencesDir, { recursive: true });
    writeFileSync(join(config.referencesDir, '0123456789abcdef.png'), PNG);
    writeFileSync(
      join(config.referencesDir, '0123456789abcdef.json'),
      JSON.stringify({
        spec: drawnFor,
        canonical: canonicalSpec(drawnFor),
        prompt: 'p',
        generatedAt: '2026-10-01T00:00:00Z',
      }),
    );
    expect(service.references().map((reference) => reference.name)).toEqual(['0123456789abcdef']);
    await expect(
      service.request(body({ reference: { kind: 'generated', name: '0123456789abcdef' } })),
    ).rejects.toThrow(/different gazebo/);
    const matching = await ask(
      service,
      body({ preset: 'modern', notes, reference: { kind: 'generated', name: '0123456789abcdef' } }),
    );
    expect(matching.kind).toBe('created');
  });

  it('refuses an upload that is not a picture, and a request when generation is off', async () => {
    const { service } = setup();
    await expect(
      service.request(
        body({ reference: { kind: 'upload', dataUrl: 'data:image/png;base64,bm90IGFuIGltYWdl' } }),
      ),
    ).rejects.toThrow(/not a PNG or JPEG/);
    const off = setup({ enabled: false, reason: 'off' });
    await expect(off.service.request(body())).rejects.toThrow(/off/);
  });
});

describe('admission', () => {
  const base = {
    creditsThisMonth: 0,
    inFlight: 0,
    estimatedCost: 30,
    ceiling: 300,
    maxInFlight: 2,
  };

  it('lets a request in under the ceiling and the limit', () => {
    expect(admission(base)).toBeNull();
  });

  it('counts what is in flight at its estimated cost against the ceiling', () => {
    // 240 spent + 30 in flight + 30 asked for is exactly the 300 ceiling; one credit more is over.
    expect(admission({ ...base, creditsThisMonth: 240, inFlight: 1 })).toBeNull();
    expect(admission({ ...base, creditsThisMonth: 241, inFlight: 1 })).toMatch(/over the ceiling/);
  });

  it('refuses at the in-flight limit whatever the budget', () => {
    expect(admission({ ...base, inFlight: 2 })).toMatch(/already being made/);
  });
});
