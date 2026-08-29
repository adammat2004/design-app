import type { PlanDocument } from '@garden-studio/schema';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
