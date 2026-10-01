import { z } from 'zod';
import { ModelAssetSpecSchema } from './spec.js';

/**
 * The model lab's HTTP contract: asking for a library model, watching it being made, and publishing
 * or rejecting it. Shared by `apps/api`'s model-assets module and `apps/web`'s `/model-lab`, so the
 * two cannot disagree about a job's shape — the rule every request in this project follows.
 *
 * **Development only.** Generation spends Meshy credits, so every route answers 404 in production
 * and 503 without a key; nothing a garden owner does can reach it. See "Library models from Meshy"
 * in CLAUDE.md.
 */

/**
 * Where a job is. Each step is one call to `advance`, claimed with a compare-and-swap on this column,
 * so two callers can never both submit or both download.
 *
 * - `requested` → `submitting` (claimed; Meshy is being asked) → `submitted` (Meshy `PENDING`)
 *   → `generating` (`IN_PROGRESS`) → `downloading` → `processing` → `review`;
 * - from `review`, a person: `approved` (published to the library) or `rejected`;
 * - `failed` and `cancelled` from anywhere they can honestly happen.
 */
export const ModelJobStatusSchema = z.enum([
  'requested',
  'submitting',
  'submitted',
  'generating',
  'downloading',
  'processing',
  'review',
  'approved',
  'rejected',
  'failed',
  'cancelled',
]);
export type ModelJobStatus = z.infer<typeof ModelJobStatusSchema>;

/** Statuses a job can still move out of without a person deciding. */
export const LIVE_MODEL_JOB_STATUSES: readonly ModelJobStatus[] = [
  'requested',
  'submitting',
  'submitted',
  'generating',
  'downloading',
  'processing',
];

/** What processing found: the published file's facts and anything a reviewer should see. */
export const ModelJobResultSchema = z.object({
  naturalSize: z.tuple([z.number(), z.number(), z.number()]),
  triangles: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  maxTexturePx: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  /** Anything here refuses publishing. */
  defects: z.array(z.string()),
  /** The quarter turn the processed file was made with. */
  frontYawDeg: z.number().int(),
  /** The upright stretch the processed file was made with: 1 unless a reviewer fitted its height. */
  heightStretch: z.number().positive().default(1),
});
export type ModelJobResult = z.infer<typeof ModelJobResultSchema>;

export const ModelJobSchema = z.object({
  id: z.string().uuid(),
  status: ModelJobStatusSchema,
  spec: ModelAssetSpecSchema,
  specHash: z.string(),
  /** The generated reference it was made from (its file stem), or `null` for an uploaded picture. */
  referenceName: z.string().nullable(),
  aiModel: z.string(),
  meshyTaskId: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  /** Credits Meshy says the task consumed — 0 until it finishes, and 0 for a failed task. */
  credits: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  result: ModelJobResultSchema.nullable(),
  publishedAssetId: z.string().nullable(),
  /** The files the API will serve for this job (`GET …/files/:name`). */
  files: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModelJob = z.infer<typeof ModelJobSchema>;

const Metres = z.number().positive().max(20);

/** What the lab sends: the spec in the plan's own words, and the picture to make it from. */
export const ModelGenerationRequestSchema = z.object({
  symbol: z.string(),
  preset: z.string(),
  frame: z.string().optional(),
  roofFinish: z.string().optional(),
  /** Checked against the structure's definition by `specForPreset`, like every choice here. */
  roofKind: z.string().optional(),
  size: z.object({ width: Metres, depth: Metres, height: Metres }).optional(),
  notes: z.string().max(200).optional(),
  reference: z.discriminatedUnion('kind', [
    /** A picture `tools/assets generate:references` drew, by its file stem. */
    z.object({ kind: z.literal('generated'), name: z.string().regex(/^[0-9a-f]{16}$/) }),
    /** A picture the person uploaded, as a PNG or JPEG data URI. */
    z.object({
      kind: z.literal('upload'),
      dataUrl: z.string().regex(/^data:image\/(png|jpeg);base64,/),
    }),
  ]),
  /** Generate again even though the library or a live job already answers this spec. */
  force: z.boolean().default(false),
});
export type ModelGenerationRequest = z.infer<typeof ModelGenerationRequestSchema>;

export const ModelRequestResultSchema = z.discriminatedUnion('kind', [
  /** The library already has a model of exactly this; nothing was spent. */
  z.object({ kind: z.literal('reused'), assetId: z.string() }),
  /** A job for exactly this is already under way or awaiting review; nothing was spent. */
  z.object({ kind: z.literal('existing'), job: ModelJobSchema }),
  z.object({ kind: z.literal('created'), job: ModelJobSchema }),
]);
export type ModelRequestResult = z.infer<typeof ModelRequestResultSchema>;

export const ModelPublishRequestSchema = z.object({
  /** The library id: lower-case words joined by hyphens, also the file stem. */
  assetId: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9.]+)*$/)
    .max(80),
  /** The quarter turn that puts the model's front towards +Z, as the reviewer saw it. */
  frontYawDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  /** Square and symmetric enough to be turned a quarter to fit an element. */
  turnable: z.boolean(),
  familyId: z.string().optional(),
  /**
   * Stretch it upright to the height the spec asked for. A reviewer's choice for a model Meshy made
   * too squat or too tall, never a default; the entry records how far (`heightStretch`).
   */
  fitHeight: z.boolean().default(false),
});
export type ModelPublishRequest = z.infer<typeof ModelPublishRequestSchema>;

/** A reference picture the lab can make a model from, and the spec it was drawn for. */
export const ModelReferenceSchema = z.object({
  name: z.string(),
  spec: ModelAssetSpecSchema,
  prompt: z.string(),
  generatedAt: z.string(),
});
export type ModelReference = z.infer<typeof ModelReferenceSchema>;

export const ModelLabStatusSchema = z.object({
  /** Whether generation is switched on here: a key, `MODEL_GENERATION_ENABLED=true`, not production. */
  available: z.boolean(),
  /** Why not, in a sentence, when it is not. */
  reason: z.string().nullable(),
  aiModel: z.string(),
  /** Credits consumed this calendar month (UTC), and what a request is estimated to cost. */
  creditsThisMonth: z.number().int().nonnegative(),
  estimatedCost: z.number().int().positive(),
  ceiling: z.number().int().nonnegative(),
  inFlight: z.number().int().nonnegative(),
  maxInFlight: z.number().int().positive(),
});
export type ModelLabStatus = z.infer<typeof ModelLabStatusSchema>;
