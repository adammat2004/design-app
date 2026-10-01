import type { ModelAssetSpec, ModelJobResult, PlanDocument } from '@garden-studio/schema';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * A saved plan is stored as a JSONB document rather than normalised spatial columns.
 *
 * Every spatial check we run is *within* a single plan (feature inside boundary, features
 * against each other, elements against the house), so per-row geometry columns and GiST
 * indexes would buy nothing, and the document shape is still growing.
 *
 * PostGIS is used as the geometry engine instead: `GeometryValidationService` builds geometries
 * inline from the candidate payload, so validation never needs rows to exist.
 *
 * `name` is a column rather than a document field because a project list needs it without
 * parsing jsonb, and `updated_at` is the real "last saved" the wizard's status bar shows.
 */
export const planProjects = pgTable('plan_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('My garden'),
  document: jsonb('document').$type<PlanDocument>().notNull(),
  /**
   * Optimistic-concurrency token, bumped on every write. Each section patch carries the
   * revision it was based on, so two tabs editing the same step produce a 409 instead of a
   * silent lost update.
   */
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlanProjectRow = typeof planProjects.$inferSelect;

/**
 * What a person did with a design that was offered to them.
 *
 * The one table that is not a plan. It exists because every number the evaluation harness reports
 * is the scorer marking the generator's homework against rules the same author wrote — circular by
 * construction — and these rows are the only outside opinion the project can collect without a user
 * study: which of three concepts was chosen, and what was changed about it straight afterwards.
 *
 * **JSONB for the payload, and a real column for the two things that would be queried.** `kind` and
 * `plan_project_id` are what any question starts from ("what do people delete", "what happened to
 * this plan"), and the rest is a small open bag that will grow as more is worth recording. That is
 * the same argument `plan_projects.document` makes, one level down.
 *
 * **Cascading delete, deliberately.** Telemetry about a plan nobody can open again is a row nobody
 * can interpret: `strategy` and `element_id` only mean anything beside the document they came from.
 *
 * **Nothing in `generation/design/**` reads this.** A scorer consuming its own feedback would close
 * the loop and stop being inspectable.
 */
export const designEvents = pgTable(
  'design_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planProjectId: uuid('plan_project_id')
      .notNull()
      .references(() => planProjects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Stamped by Postgres, never by JavaScript — see the `updated_at` note in CLAUDE.md. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /* The two questions worth asking: what happened to this plan, and what do people do to X. */
    index('design_events_plan_idx').on(table.planProjectId, table.createdAt),
    index('design_events_kind_idx').on(table.kind),
  ],
);

export type DesignEventRow = typeof designEvents.$inferSelect;

/**
 * The ledger of library models being made with Meshy — not the library itself.
 *
 * The library is `apps/web/public/models/library/library.json`, checked in, because a fresh clone,
 * a marker and the phone all need it without this database. What lives here is the work in progress
 * and what it cost: a spec, which Meshy task is making it, where it has got to, and the credits it
 * consumed. The files themselves are on disk under `MODEL_STORAGE_DIR` (gitignored), one folder per
 * job, because Meshy deletes its own copy three days after it finishes.
 *
 * `status` is advanced one step at a time by `ModelJobsService.advance`, every step claimed with a
 * compare-and-swap on it, so two pollers can never both submit (and pay twice) or both download.
 *
 * **One live job per spec**, by a partial unique index: asking twice for the same gazebo while the
 * first is still being made — or is waiting for review — finds the first instead of paying for a
 * second. A failed, rejected or cancelled job releases the spec; an approved one is in the library,
 * which is checked first anyway.
 */
export const modelGenerationJobs = pgTable(
  'model_generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spec: jsonb('spec').$type<ModelAssetSpec>().notNull(),
    specHash: text('spec_hash').notNull(),
    status: text('status').notNull(),
    /** A generated reference's file stem, or null for an uploaded picture. */
    referenceName: text('reference_name'),
    referenceSha256: text('reference_sha256').notNull(),
    aiModel: text('ai_model').notNull(),
    meshyTaskId: text('meshy_task_id'),
    progress: integer('progress').notNull().default(0),
    /** What Meshy says the task consumed: 0 until it finishes, and 0 when it fails. */
    credits: integer('credits').notNull().default(0),
    /** Times it has been submitted. A Meshy failure costs nothing and is retried once. */
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    /** When Meshy deletes the result; past this an unfetched result is gone. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    result: jsonb('result').$type<ModelJobResult>(),
    publishedAssetId: text('published_asset_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('model_generation_jobs_live_spec_idx')
      .on(table.specHash)
      .where(sql`status not in ('failed', 'rejected', 'cancelled', 'approved')`),
    index('model_generation_jobs_status_idx').on(table.status),
  ],
);

export type ModelGenerationJobRow = typeof modelGenerationJobs.$inferSelect;
