import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ModelLibraryEntry } from '@garden-studio/ar-contract';
import {
  MalformedModelError,
  processModel,
  STRUCTURE_BUDGETS,
} from '@garden-studio/model-pipeline';
import {
  canonicalSpec,
  LIVE_MODEL_JOB_STATUSES,
  MODEL_SPEC_VERSION,
  ModelReferenceSchema,
  specForPreset,
  SymbolIdSchema,
  type ModelAssetSpec,
  type ModelGenerationRequest,
  type ModelJob,
  type ModelJobResult,
  type ModelJobStatus,
  type ModelLabStatus,
  type ModelPublishRequest,
  type ModelReference,
  type ModelRequestResult,
  type PresetSpecOptions,
  type RoofKind,
  type StructureFinishId,
} from '@garden-studio/schema';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { modelGenerationJobs, type ModelGenerationJobRow } from '../db/schema.js';
import { admission, estimatedCost, type ModelAssetsConfig } from './model-assets.config.js';
import { LibraryConflictError, publishToLibrary, readLibrary } from './model-library.writer.js';
import { ModelStorage } from './model-storage.js';
import { imageTo3dRequest, MeshyError, type MeshyApi, type MeshyTask } from './meshy.client.js';

export const MESHY = Symbol('MESHY');
export const MODEL_ASSETS_CONFIG = Symbol('MODEL_ASSETS_CONFIG');

const MAX_GLB_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** A Meshy failure consumes no credits, so one more go is free; a second failure is the answer. */
const MAX_ATTEMPTS = 2;

/**
 * Making library models with Meshy: the job ledger, its one-step-at-a-time lifecycle, and publishing.
 *
 * **No queue, no worker, no timer.** A job advances when somebody asks about it — the lab polls
 * `GET /model-assets/jobs/:id` while one is live — and once at boot, which is what recovers a job a
 * restart interrupted (its Meshy task id was stored the moment Meshy returned it). That is enough for
 * a development tool generating a handful of models, and adding a timer later is one line.
 *
 * **Every step is claimed before it is done**, by a compare-and-swap on `status`: `UPDATE … WHERE
 * status = <expected>`, and only the caller whose update touched the row goes on. Two pollers can
 * therefore never both submit — which would be paid for twice — nor both download.
 *
 * **Nothing on a user's path reaches this.** The generator, the assistants and the editor never
 * import it; `model-assets.architecture.test.ts` fails the day one does. A garden is drawn from the
 * checked-in library and never waits on, or pays for, a generation.
 */
@Injectable()
export class ModelJobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelJobsService.name);
  private readonly storage: ModelStorage;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MESHY) private readonly meshy: MeshyApi | null,
    @Inject(MODEL_ASSETS_CONFIG) private readonly config: ModelAssetsConfig,
    @Optional() private readonly options: { sweepOnBoot?: boolean } = {},
  ) {
    this.storage = new ModelStorage(config.storageDir);
  }

  /** A restart mid-generation is recovered here: every live job is looked at once. */
  onApplicationBootstrap(): void {
    if (this.options.sweepOnBoot === false || !this.meshy) return;
    void this.sweep().catch((error: unknown) =>
      this.logger.warn(`Boot sweep failed: ${(error as Error).message}`),
    );
  }

  /* ---------------------------------------------------------------- reading */

  async status(): Promise<ModelLabStatus> {
    return {
      available: this.config.enabled && this.meshy !== null,
      reason: this.meshy ? this.config.reason : (this.config.reason ?? 'Meshy is not configured.'),
      aiModel: this.config.aiModel,
      creditsThisMonth: await this.creditsThisMonth(),
      estimatedCost: estimatedCost(this.config.aiModel),
      ceiling: this.config.ceiling,
      inFlight: await this.inFlight(),
      maxInFlight: this.config.maxInFlight,
    };
  }

  async list(): Promise<ModelJob[]> {
    const rows = await this.db
      .select()
      .from(modelGenerationJobs)
      .orderBy(desc(modelGenerationJobs.createdAt))
      .limit(50);
    return rows.map((row) => this.toJob(row));
  }

  /** A job, advanced one step first: polling is what moves a job along. */
  async get(id: string): Promise<ModelJob> {
    await this.advance(id);
    return this.toJob(await this.row(id));
  }

  file(id: string, name: string): { bytes: Buffer; contentType: string } {
    const bytes = this.storage.read(id, name);
    if (!bytes) throw new NotFoundException(`No ${name} for that job.`);
    return { bytes, contentType: ModelStorage.contentType(name) };
  }

  /** The pictures `tools/assets generate:references` has drawn, newest first, with what each is of. */
  references(): ModelReference[] {
    const dir = this.config.referencesDir;
    if (!existsSync(dir)) return [];
    const found: ModelReference[] = [];
    for (const file of readdirSync(dir)) {
      const match = /^([0-9a-f]{16})\.json$/.exec(file);
      if (!match || !existsSync(join(dir, `${match[1]}.png`))) continue;
      try {
        const sidecar = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<
          string,
          unknown
        >;
        found.push(ModelReferenceSchema.parse({ ...sidecar, name: match[1] }));
      } catch {
        // A sidecar written by an older tool, or half-written: not offered.
      }
    }
    return found.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  referenceImage(name: string): Buffer {
    if (!/^[0-9a-f]{16}$/.test(name)) throw new NotFoundException('No such reference.');
    const path = join(this.config.referencesDir, `${name}.png`);
    if (!existsSync(path)) throw new NotFoundException('No such reference.');
    return readFileSync(path);
  }

  /* ---------------------------------------------------------------- asking for a model */

  /**
   * Ask for a model of this spec. Reuse first, every time: the library, then a live job for the
   * same spec — and only then, within the month's ceiling and the in-flight limit, a new job.
   * `force` passes over the library (to make a better model of something it already has) but never
   * over a live job: two jobs making the same thing at once is the duplicate the index refuses.
   */
  async request(body: ModelGenerationRequest): Promise<ModelRequestResult> {
    if (!this.meshy || !this.config.enabled) {
      throw new ServiceUnavailableException(
        this.config.reason ?? 'Model generation is not configured.',
      );
    }
    const spec = this.specOf(body);
    const canonical = canonicalSpec(spec);
    const specHash = sha256(canonical);

    if (!body.force) {
      const reused = libraryAnswer(readLibrary(this.config), spec, specHash);
      if (reused) return { kind: 'reused', assetId: reused.id };
    }
    const live = await this.liveJobFor(specHash);
    if (live) return { kind: 'existing', job: this.toJob(live) };

    const refused = admission({
      creditsThisMonth: await this.creditsThisMonth(),
      inFlight: await this.inFlight(),
      estimatedCost: estimatedCost(this.config.aiModel),
      ceiling: this.config.ceiling,
      maxInFlight: this.config.maxInFlight,
    });
    if (refused) throw new HttpException(refused, 429);

    const reference = this.referenceFor(body, canonical);

    let row: ModelGenerationJobRow;
    try {
      [row] = (await this.db
        .insert(modelGenerationJobs)
        .values({
          spec,
          specHash,
          status: 'requested',
          referenceName: body.reference.kind === 'generated' ? body.reference.name : null,
          referenceSha256: sha256(reference.bytes),
          aiModel: this.config.aiModel,
        })
        .returning()) as [ModelGenerationJobRow];
    } catch (error) {
      // Two requests for one spec at once: the partial unique index lets exactly one in.
      const raced = await this.liveJobFor(specHash);
      if (raced) return { kind: 'existing', job: this.toJob(raced) };
      throw error;
    }
    this.storage.write(
      row.id,
      reference.mime === 'image/png' ? 'reference.png' : 'reference.jpg',
      reference.bytes,
    );

    // Submitted straight away, so the answer already says whether Meshy took it.
    await this.advance(row.id);
    return { kind: 'created', job: this.toJob(await this.row(row.id)) };
  }

  /* ---------------------------------------------------------------- the lifecycle */

  /** Move a job on by one step, if it can move. Safe to call as often as anybody likes. */
  async advance(id: string): Promise<void> {
    const row = await this.row(id);
    switch (row.status as ModelJobStatus) {
      case 'requested':
        return this.submit(row);
      case 'submitted':
      case 'generating':
        return this.poll(row);
      default:
        return;
    }
  }

  /**
   * Every live job, once: what a boot does, and `models:sync`. A step claimed longer ago than
   * `staleAfterMs` died with the process that claimed it, and is put back where it can be retried:
   * a download is re-fetched (free); processing is re-run (free); a submission whose answer was
   * lost cannot be known to have reached Meshy, so it fails and says to check the dashboard.
   */
  async sweep(): Promise<{ looked: number }> {
    const stale = new Date(Date.now() - this.config.staleAfterMs);
    await this.db
      .update(modelGenerationJobs)
      .set({ status: 'generating', updatedAt: sql`now()` })
      .where(
        and(
          eq(modelGenerationJobs.status, 'downloading'),
          lt(modelGenerationJobs.updatedAt, stale),
        ),
      );
    await this.db
      .update(modelGenerationJobs)
      .set({
        status: 'failed',
        error:
          'The server stopped while submitting this to Meshy, so whether Meshy received it is ' +
          'unknown. Check the Meshy dashboard before asking again.',
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(modelGenerationJobs.status, 'submitting'), lt(modelGenerationJobs.updatedAt, stale)),
      );
    const reprocess = await this.db
      .update(modelGenerationJobs)
      .set({ updatedAt: sql`now()` })
      .where(
        and(eq(modelGenerationJobs.status, 'processing'), lt(modelGenerationJobs.updatedAt, stale)),
      )
      .returning();
    for (const row of reprocess) await this.process(row);

    const live = await this.db
      .select()
      .from(modelGenerationJobs)
      .where(inArray(modelGenerationJobs.status, ['requested', 'submitted', 'generating']));
    for (const row of live) {
      try {
        await this.advance(row.id);
      } catch (error) {
        this.logger.warn(`Could not advance ${row.id}: ${(error as Error).message}`);
      }
    }
    return { looked: live.length + reprocess.length };
  }

  private async submit(row: ModelGenerationJobRow): Promise<void> {
    if (!this.meshy || !this.config.enabled) return;
    const claimed = await this.transition(row.id, 'requested', { status: 'submitting' });
    if (!claimed) return;

    const reference = this.storage.reference(row.id);
    if (!reference) {
      await this.transition(row.id, 'submitting', {
        status: 'failed',
        error: 'The reference picture is missing.',
      });
      return;
    }
    try {
      const balance = await this.meshy.balance();
      if (balance < this.config.minBalance) {
        await this.transition(row.id, 'submitting', {
          status: 'failed',
          error: `Meshy has ${balance} credits, under MESHY_MIN_BALANCE (${this.config.minBalance}). Nothing was spent.`,
        });
        return;
      }
      const taskId = await this.meshy.createImageTo3d(
        imageTo3dRequest(
          `data:${reference.mime};base64,${reference.bytes.toString('base64')}`,
          row.aiModel,
          STRUCTURE_BUDGETS.triangles,
        ),
      );
      this.logger.log(`Job ${row.id}: Meshy task ${taskId} on ${row.aiModel}`);
      await this.transition(row.id, 'submitting', {
        status: 'submitted',
        meshyTaskId: taskId,
        attempts: row.attempts + 1,
        progress: 0,
        error: null,
      });
    } catch (error) {
      await this.transition(row.id, 'submitting', submitFailure(error));
    }
  }

  private async poll(row: ModelGenerationJobRow): Promise<void> {
    if (!this.meshy || !row.meshyTaskId) return;
    // However often the lab asks, Meshy is asked at most once per interval per job.
    if (Date.now() - row.updatedAt.getTime() < this.config.pollIntervalMs) return;

    let task: MeshyTask;
    try {
      task = await this.meshy.getImageTo3d(row.meshyTaskId);
    } catch (error) {
      if (error instanceof MeshyError && error.failure === 'not-found') {
        await this.transition(row.id, ['submitted', 'generating'], {
          status: 'failed',
          error: 'Meshy no longer has this task.',
        });
      } else {
        // Transient: say so, and the next poll tries again.
        await this.transition(row.id, row.status as ModelJobStatus, { error: messageOf(error) });
      }
      return;
    }

    const progress = Math.max(0, Math.min(100, Math.round(task.progress)));
    switch (task.status) {
      case 'PENDING':
        await this.transition(row.id, ['submitted', 'generating'], {
          status: 'submitted',
          progress,
          error: null,
        });
        return;
      case 'IN_PROGRESS':
        await this.transition(row.id, ['submitted', 'generating'], {
          status: 'generating',
          progress,
          error: null,
        });
        return;
      case 'FAILED':
      case 'CANCELED': {
        const reason =
          task.task_error?.message ?? `Meshy reported the task ${task.status.toLowerCase()}.`;
        // A failed task consumed nothing, so one more go is free; a second failure is the answer.
        await this.transition(
          row.id,
          ['submitted', 'generating'],
          row.attempts < MAX_ATTEMPTS && task.status === 'FAILED'
            ? {
                status: 'requested',
                meshyTaskId: null,
                progress: 0,
                error: `${reason} Trying once more.`,
              }
            : { status: 'failed', error: reason },
        );
        if (row.attempts < MAX_ATTEMPTS && task.status === 'FAILED')
          await this.submit(await this.row(row.id));
        return;
      }
      case 'SUCCEEDED': {
        const claimed = await this.transition(row.id, ['submitted', 'generating'], {
          status: 'downloading',
          progress: 100,
          credits: task.consumed_credits ?? 0,
          expiresAt: task.expires_at ? new Date(task.expires_at) : null,
          error: null,
        });
        if (claimed) await this.download(claimed, task);
        return;
      }
    }
  }

  private async download(row: ModelGenerationJobRow, task: MeshyTask): Promise<void> {
    const meshy = this.meshy!;
    try {
      const glb = task.model_urls?.glb;
      if (!glb) throw new MeshyError('rejected', null, 'Meshy finished without a GLB.');
      this.storage.write(row.id, 'model.glb', await meshy.download(glb, MAX_GLB_BYTES));
      for (const [view, url] of Object.entries(task.thumbnail_urls ?? {})) {
        if (url && /^(front|back|left|right)$/.test(view)) {
          this.storage.write(
            row.id,
            `thumb-${view}.png`,
            await meshy.download(url, MAX_IMAGE_BYTES),
          );
        }
      }
      if (task.thumbnail_url) {
        this.storage.write(
          row.id,
          'thumb.png',
          await meshy.download(task.thumbnail_url, MAX_IMAGE_BYTES),
        );
      }
      this.storage.write(row.id, 'task.json', JSON.stringify(withoutSignedUrls(task), null, 2));
    } catch (error) {
      const expired = row.expiresAt !== null && row.expiresAt.getTime() < Date.now();
      await this.transition(row.id, 'downloading', {
        status: expired ? 'failed' : 'generating',
        error: expired
          ? 'Meshy deleted the result before it was downloaded (results are kept three days).'
          : `Download failed, will retry: ${messageOf(error)}`,
      });
      return;
    }
    const processing = await this.transition(row.id, 'downloading', { status: 'processing' });
    if (processing) await this.process(processing);
  }

  /** Normalise, optimise and judge the downloaded model; then it waits for a person. */
  private async process(
    row: ModelGenerationJobRow,
    frontYawDeg = 0,
    fitHeight = false,
  ): Promise<ModelJobResult | null> {
    const raw = this.storage.read(row.id, 'model.glb');
    if (!raw) {
      await this.transition(row.id, 'processing', {
        status: 'generating',
        error: 'The download is missing.',
      });
      return null;
    }
    try {
      const { bytes, report } = await processModel(raw, {
        nominal: row.spec.nominal,
        frontYawDeg,
        fitHeight,
        budgets: STRUCTURE_BUDGETS,
      });
      this.storage.write(row.id, 'processed.glb', bytes);
      this.storage.write(row.id, 'report.json', JSON.stringify(report, null, 2));
      const result: ModelJobResult = {
        naturalSize: report.normalised.naturalSize,
        triangles: report.output.counts.triangles,
        bytes: report.bytes,
        maxTexturePx: report.output.maxTexturePx,
        warnings: report.warnings,
        defects: report.defects,
        frontYawDeg,
        heightStretch: report.normalised.heightStretch,
      };
      await this.transition(row.id, ['processing', 'review'], {
        status: 'review',
        result,
        error: null,
      });
      return result;
    } catch (error) {
      await this.transition(row.id, ['processing', 'review'], {
        status: 'failed',
        error:
          error instanceof MalformedModelError
            ? `Meshy's file is not a usable glTF: ${error.message}`
            : `Processing failed: ${messageOf(error)}`,
      });
      return null;
    }
  }

  /* ---------------------------------------------------------------- a person's decisions */

  async cancel(id: string): Promise<ModelJob> {
    const row = await this.row(id);
    if (row.status === 'requested') {
      await this.transition(id, 'requested', { status: 'cancelled' });
    } else if (row.status === 'submitted' && row.meshyTaskId && this.meshy) {
      try {
        // Deleting a task Meshy has not started refunds it.
        await this.meshy.deleteImageTo3d(row.meshyTaskId);
      } catch (error) {
        if (error instanceof MeshyError && error.failure === 'conflict') {
          throw new ConflictException(
            'Meshy has already started it; it will finish, and can be rejected.',
          );
        }
        throw error;
      }
      await this.transition(id, ['submitted', 'generating'], { status: 'cancelled' });
    } else {
      throw new ConflictException(
        `A ${row.status} job cannot be cancelled${row.status === 'generating' ? ': Meshy has started it, so it will finish and can be rejected' : ''}.`,
      );
    }
    return this.toJob(await this.row(id));
  }

  async reject(id: string): Promise<ModelJob> {
    const done = await this.transition(id, 'review', { status: 'rejected' });
    if (!done) throw new ConflictException('Only a job awaiting review can be rejected.');
    return this.toJob(done);
  }

  /**
   * Publish a reviewed model to the library under the id a person chose. The front turn they set is
   * applied by reprocessing from Meshy's file; anything the processing calls a defect refuses.
   */
  async publish(id: string, body: ModelPublishRequest): Promise<ModelJob> {
    let row = await this.row(id);
    if (row.status !== 'review')
      throw new ConflictException('Only a job awaiting review can be published.');

    // Reprocessed from Meshy's own file whenever the turn or the height fit chosen differs from
    // how the processed file was made, so what is published is exactly what the reviewer chose.
    let result = row.result;
    const stretched = (result?.heightStretch ?? 1) !== 1;
    if (!result || result.frontYawDeg !== body.frontYawDeg || stretched !== body.fitHeight) {
      result = await this.process(row, body.frontYawDeg, body.fitHeight);
      row = await this.row(id);
      if (!result || row.status !== 'review') {
        throw new UnprocessableEntityException(row.error ?? 'Reprocessing failed.');
      }
    }
    if (result.defects.length > 0) {
      throw new UnprocessableEntityException(`Not publishable: ${result.defects.join('; ')}`);
    }
    const glb = this.storage.read(id, 'processed.glb');
    const reference = this.storage.reference(id);
    if (!glb || !reference)
      throw new UnprocessableEntityException('The processed file or the reference is missing.');

    const thumb = this.storage.read(id, 'thumb.png');
    const entry: ModelLibraryEntry = {
      id: body.assetId,
      file: `models/library/${body.assetId}.glb`,
      thumbnail: thumb ? `models/library/${body.assetId}.webp` : null,
      bytes: glb.length,
      sha256: sha256(glb),
      triangles: result.triangles,
      maxTexturePx: result.maxTexturePx,
      depicts: {
        symbol: row.spec.symbol,
        structure: row.spec.structure,
        material: row.spec.material,
        style: row.spec.style,
      },
      naturalSize: result.naturalSize.map((value) => Number(value.toFixed(4))) as [
        number,
        number,
        number,
      ],
      pivot: 'base-centre',
      up: '+y',
      front: '+z',
      fit: { tolerance: 0.15, turnable: body.turnable },
      familyId: body.familyId ?? body.assetId,
      ...(result.heightStretch !== 1
        ? { heightStretch: Number(result.heightStretch.toFixed(4)) }
        : {}),
      source: {
        provider: 'meshy',
        endpoint: 'image-to-3d',
        taskId: row.meshyTaskId ?? 'unknown',
        aiModel: row.aiModel,
        credits: row.credits,
        specHash: row.specHash,
        specVersion: MODEL_SPEC_VERSION,
        referenceSha256: row.referenceSha256,
        generatedAt: row.updatedAt.toISOString(),
      },
      licence: 'meshy-paid-private',
      approvedAt: new Date().toISOString(),
    };
    try {
      await publishToLibrary(this.config, {
        entry,
        glb,
        thumbnailPng: thumb,
        reference: reference.bytes,
      });
    } catch (error) {
      if (error instanceof LibraryConflictError) throw new ConflictException(error.message);
      throw error;
    }
    const done = await this.transition(id, 'review', {
      status: 'approved',
      publishedAssetId: body.assetId,
    });
    this.logger.log(`Job ${id}: published ${body.assetId}`);
    return this.toJob(done ?? (await this.row(id)));
  }

  /* ---------------------------------------------------------------- helpers */

  private specOf(body: ModelGenerationRequest): ModelAssetSpec {
    try {
      const options: PresetSpecOptions = {
        ...(body.frame ? { frame: body.frame as StructureFinishId } : {}),
        ...(body.roofFinish ? { roofFinish: body.roofFinish as StructureFinishId } : {}),
        ...(body.roofKind ? { roofKind: body.roofKind as RoofKind } : {}),
        ...(body.size ? { nominal: body.size } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      };
      return specForPreset(SymbolIdSchema.parse(body.symbol), body.preset, options);
    } catch (error) {
      throw new BadRequestException(messageOf(error));
    }
  }

  /** The picture to send, checked: a generated one must have been drawn for this very spec. */
  private referenceFor(
    body: ModelGenerationRequest,
    canonical: string,
  ): { bytes: Buffer; mime: 'image/png' | 'image/jpeg' } {
    if (body.reference.kind === 'generated') {
      const { name } = body.reference;
      const reference = this.references().find((candidate) => candidate.name === name);
      if (!reference) throw new BadRequestException('No such generated reference.');
      if (canonicalSpec(reference.spec) !== canonical) {
        throw new BadRequestException(
          'That reference was drawn for a different gazebo than the one asked for. Pick the reference ' +
            'that matches, or draw one for this spec with `generate:references`.',
        );
      }
      return { bytes: this.referenceImage(name), mime: 'image/png' };
    }
    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/s.exec(body.reference.dataUrl);
    if (!match) throw new BadRequestException('The upload is not a PNG or JPEG data URI.');
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new BadRequestException('The upload is over 10 MB.');
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (!png && !jpeg) throw new BadRequestException('The upload is not a PNG or JPEG image.');
    return { bytes, mime: png ? 'image/png' : 'image/jpeg' };
  }

  private async liveJobFor(specHash: string): Promise<ModelGenerationJobRow | null> {
    const [row] = await this.db
      .select()
      .from(modelGenerationJobs)
      .where(
        and(
          eq(modelGenerationJobs.specHash, specHash),
          inArray(modelGenerationJobs.status, [...LIVE_MODEL_JOB_STATUSES, 'review']),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async creditsThisMonth(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${modelGenerationJobs.credits}), 0)::int` })
      .from(modelGenerationJobs)
      .where(
        gte(
          modelGenerationJobs.createdAt,
          sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
        ),
      );
    return row?.total ?? 0;
  }

  private async inFlight(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(modelGenerationJobs)
      .where(inArray(modelGenerationJobs.status, [...LIVE_MODEL_JOB_STATUSES]));
    return row?.count ?? 0;
  }

  private async row(id: string): Promise<ModelGenerationJobRow> {
    const [row] = await this.db
      .select()
      .from(modelGenerationJobs)
      .where(eq(modelGenerationJobs.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('No such model job.');
    return row;
  }

  /**
   * The compare-and-swap every step is claimed with: the update only lands if the job is still in
   * one of `from`, and only the caller it landed for gets the row back.
   */
  private async transition(
    id: string,
    from: ModelJobStatus | ModelJobStatus[],
    set: Partial<typeof modelGenerationJobs.$inferInsert>,
  ): Promise<ModelGenerationJobRow | null> {
    const [row] = await this.db
      .update(modelGenerationJobs)
      .set({ ...set, updatedAt: sql`now()` })
      .where(
        and(
          eq(modelGenerationJobs.id, id),
          inArray(modelGenerationJobs.status, Array.isArray(from) ? from : [from]),
        ),
      )
      .returning();
    return row ?? null;
  }

  private toJob(row: ModelGenerationJobRow): ModelJob {
    return {
      id: row.id,
      status: row.status as ModelJobStatus,
      spec: row.spec,
      specHash: row.specHash,
      referenceName: row.referenceName,
      aiModel: row.aiModel,
      meshyTaskId: row.meshyTaskId,
      progress: row.progress,
      credits: row.credits,
      attempts: row.attempts,
      error: row.error,
      result: row.result,
      publishedAssetId: row.publishedAssetId,
      files: this.storage.list(row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/* ---------------------------------------------------------------- pure helpers */

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a failed submission becomes, by why it failed. Nothing here retries the POST. */
function submitFailure(error: unknown): Partial<typeof modelGenerationJobs.$inferInsert> {
  if (!(error instanceof MeshyError)) return { status: 'failed', error: messageOf(error) };
  switch (error.failure) {
    case 'queue-full':
      // Meshy's queue is full; it clears when a task finishes, so this waits for a later poll.
      return {
        status: 'requested',
        error: 'Meshy’s queue is full; it will be submitted on a later poll.',
      };
    case 'no-credits':
      return { status: 'failed', error: 'The Meshy account has no credits left.' };
    case 'unauthorised':
      return { status: 'failed', error: 'Meshy refused the key.' };
    case 'network':
    case 'server':
      return {
        status: 'failed',
        error:
          `Meshy may or may not have received this (${error.message}). Check the Meshy dashboard ` +
          'before asking again, or it may be paid for twice.',
      };
    default:
      return { status: 'failed', error: `Meshy refused it: ${error.message}` };
  }
}

/** Every signed URL replaced by its path: they expire with the result and are a live link besides. */
function withoutSignedUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.search) return `${url.origin}${url.pathname}`;
    } catch {
      /* not a URL */
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(withoutSignedUrls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, withoutSignedUrls(inner)]),
    );
  }
  return value;
}

/**
 * A published model that already answers this spec: the same spec exactly, or one depicting the same
 * facts whose size is within its own fit band of the spec's — the rule the builder draws by, so the
 * lab never pays for a model the plan would not draw differently.
 */
export function libraryAnswer(
  library: { entries: ModelLibraryEntry[] },
  spec: ModelAssetSpec,
  specHash: string,
): ModelLibraryEntry | null {
  for (const entry of library.entries) {
    if (entry.source.specHash === specHash) return entry;
    if (entry.depicts.symbol !== spec.symbol) continue;
    if (
      JSON.stringify(sortedFacts(entry.depicts.structure)) !==
      JSON.stringify(sortedFacts(spec.structure))
    )
      continue;
    if (entry.depicts.material !== spec.material) continue;
    const most = 1 + entry.fit.tolerance;
    const inBand = (size: [number, number, number]) =>
      size.every((value, axis) => {
        const ratio = value / entry.naturalSize[axis]!;
        return ratio <= most && ratio >= 1 / most;
      });
    const { width, depth, height } = spec.nominal;
    if (inBand([width, height, depth]) || (entry.fit.turnable && inBand([depth, height, width])))
      return entry;
  }
  return null;
}

function sortedFacts(facts: ModelAssetSpec['structure']): unknown {
  if (!facts) return null;
  return {
    frame: facts.frame,
    lighting: facts.lighting,
    model: facts.model,
    roofFinish: facts.roofFinish,
    roofKind: facts.roofKind,
    sides: { left: facts.sides.left, rear: facts.sides.rear, right: facts.sides.right },
  };
}
