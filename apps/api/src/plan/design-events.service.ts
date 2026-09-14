import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DesignEvent, RecordDesignEventsResult } from '@garden-studio/schema';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { designEvents, planProjects } from '../db/schema.js';

/**
 * Recording what a person did with the design they were offered.
 *
 * The one part of this system that measures the generator from outside it. Every number the
 * evaluation harness reports is the scorer marking the generator's homework against rules the same
 * author wrote; these rows are the only evidence of what somebody actually wanted — which of three
 * concepts they took, and what they changed about it straight afterwards.
 *
 * Three rules, and each is a way this could go wrong:
 *
 * **It never fails a user's action.** The controller answers a count and the client is
 * fire-and-forget, so a write that fails logs and returns zero. Telemetry that can break the thing
 * it is measuring is worth less than no telemetry.
 *
 * **Nothing in `generation/design/**` reads it.** A scorer consuming its own feedback would close
 * the loop and stop being inspectable: "why did it choose this" would become "because people like
 * it", which is not a claim anybody can argue with or test. The rows are for a person to read and
 * for a calibration pass to reason about offline.
 *
 * **No geometry is stored.** An event carries a category and a magnitude, never a position or an
 * outline. The plan itself is already saved, so a second copy here could only ever disagree with it.
 */
@Injectable()
export class DesignEventsService {
  private readonly logger = new Logger(DesignEventsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Store a batch against a plan.
   *
   * The plan is checked to exist first, and that is the one thing here that *is* allowed to fail
   * loudly: an event against a plan id that was never real is a client bug, and the foreign key
   * would reject it anyway with an error nobody could read. A 404 says which half is wrong.
   */
  async record(planProjectId: string, events: DesignEvent[]): Promise<RecordDesignEventsResult> {
    const [plan] = await this.db
      .select({ id: planProjects.id })
      .from(planProjects)
      .where(eq(planProjects.id, planProjectId))
      .limit(1);

    if (!plan) throw new NotFoundException('That plan does not exist.');

    try {
      const rows = await this.db
        .insert(designEvents)
        .values(
          events.map((event) => ({
            planProjectId,
            kind: event.kind,
            payload: payloadOf(event),
          })),
        )
        .returning({ id: designEvents.id });

      return { recorded: rows.length };
    } catch (error) {
      /*
       * Swallowed, like the strategic brief's model failure and for the same reason: nobody asked
       * for this and nobody is waiting on it. A user whose editor started returning errors because
       * a telemetry insert failed would be paying for a measurement they never agreed to.
       */
      this.logger.warn(
        `Could not record ${events.length} design events: ${
          error instanceof Error ? error.message : 'unknown failure'
        }`,
      );
      return { recorded: 0 };
    }
  }
}

/**
 * The event minus its kind, which is a column of its own.
 *
 * Undefined fields are dropped rather than stored as null, so a row's payload says only what the
 * emitter actually knew. `{"category": null}` and `{}` read identically to a person and differently
 * to a query, and only one of them is true.
 */
function payloadOf(event: DesignEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (event.conceptId !== undefined) payload.conceptId = event.conceptId;
  if (event.strategy !== undefined) payload.strategy = event.strategy;
  if (event.elementId !== undefined) payload.elementId = event.elementId;
  if (event.category !== undefined) payload.category = event.category;
  if (event.delta !== undefined) payload.delta = event.delta;
  return payload;
}
