import { emptyPlanDocument, type DesignEvent } from '@garden-studio/schema';
import { NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { designEvents, planProjects } from '../db/schema.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../test/db.js';
import { DesignEventsService } from './design-events.service.js';

/**
 * Telemetry, against the real database.
 *
 * Mocked, this would assert that an insert was called with the object it was handed, which proves
 * nothing worth knowing. What is worth knowing is what a row actually *contains* when it comes back
 * out — that an absent field is absent rather than null, that a plan's rows go with the plan, and
 * that a failed write never reaches the caller.
 */

const connection = await connectTestDatabase();
if (!connection) console.warn(DB_UNAVAILABLE_MESSAGE);

describe.skipIf(!connection)('recording design events', () => {
  let db: TestDatabase;
  let service: DesignEventsService;
  let planId: string;

  beforeAll(() => {
    db = connection!;
    service = new DesignEventsService(db.db);
  });

  /*
   * Its own plan, removed afterwards — never a truncate. Vitest runs files concurrently, so a suite
   * that empties a shared table deletes whatever the suite beside it is using, and `pnpm test`
   * would go back to wiping the plans a developer has open in the browser. The events go with the
   * plan through the cascading foreign key, which is the same rule the table itself is built on.
   */
  beforeEach(async () => {
    const [row] = await db.db
      .insert(planProjects)
      .values({ name: 'Telemetry', document: emptyPlanDocument() })
      .returning();
    planId = row!.id;
  });

  afterEach(async () => {
    await db.db.delete(planProjects).where(eq(planProjects.id, planId));
  });

  afterAll(async () => {
    await db?.close();
  });

  const rows = () =>
    db.db
      .select()
      .from(designEvents)
      .where(eq(designEvents.planProjectId, planId))
      .orderBy(desc(designEvents.createdAt));

  it('stores a batch and reports how many landed', async () => {
    const events: DesignEvent[] = [
      { kind: 'concept_chosen', conceptId: 'c11-0', strategy: 'terrace_and_lawn' },
      { kind: 'element_deleted', elementId: 'e4', category: 'structure' },
    ];

    expect(await service.record(planId, events)).toEqual({ recorded: 2 });
    expect((await rows()).length).toBe(2);
  });

  it('keeps the kind as a column and everything else as payload', async () => {
    await service.record(planId, [
      { kind: 'element_moved', elementId: 'e2', category: 'paved-area', delta: 1.8 },
    ]);

    const [row] = await rows();
    expect(row!.kind).toBe('element_moved');
    expect(row!.payload).toEqual({ elementId: 'e2', category: 'paved-area', delta: 1.8 });
  });

  /**
   * `{"category": null}` and `{}` read identically to a person and differently to a query, and only
   * one of them is true: the emitter did not know the category, it did not know it was nothing.
   */
  it('omits what the emitter did not know rather than storing nulls', async () => {
    await service.record(planId, [{ kind: 'plan_exported' }]);

    const [row] = await rows();
    expect(row!.payload).toEqual({});
    expect(Object.keys(row!.payload)).toHaveLength(0);
  });

  it('lets Postgres stamp the time', async () => {
    const before = new Date();
    await service.record(planId, [{ kind: 'layout_reset' }]);

    const [row] = await rows();
    expect(row!.createdAt).toBeInstanceOf(Date);
    /* Within a minute either side: the assertion is that it was stamped, not by how fast. */
    expect(Math.abs(row!.createdAt.getTime() - before.getTime())).toBeLessThan(60_000);
  });

  /**
   * The one failure here that *is* allowed to be loud. An event against a plan id that was never
   * real is a client bug, and the foreign key would refuse it anyway with an error naming a
   * constraint; a 404 says which half is wrong.
   */
  it('refuses a plan that does not exist', async () => {
    await expect(
      service.record('00000000-0000-0000-0000-000000000000', [{ kind: 'plan_exported' }]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Telemetry about a plan nobody can open again is a row nobody can interpret: `strategy` and
   * `elementId` only mean anything beside the document they came from.
   */
  it('goes when the plan goes', async () => {
    await service.record(planId, [{ kind: 'concept_chosen', conceptId: 'c11-0' }]);
    expect((await rows()).length).toBe(1);

    await db.db.delete(planProjects).where(eq(planProjects.id, planId));
    expect((await rows()).length).toBe(0);
  });

  /**
   * A user whose editor started returning errors because a telemetry insert failed would be paying
   * for a measurement they never agreed to. The insert is broken here by handing the service a
   * client whose write rejects, which is what a dropped connection looks like from inside.
   */
  it('never lets a failed write reach the caller', async () => {
    const broken = {
      select: db.db.select.bind(db.db),
      insert: () => ({
        values: () => ({
          returning: () => Promise.reject(new Error('connection lost')),
        }),
      }),
    } as unknown as TestDatabase['db'];

    const fragile = new DesignEventsService(broken);
    expect(await fragile.record(planId, [{ kind: 'plan_exported' }])).toEqual({ recorded: 0 });
  });
});
