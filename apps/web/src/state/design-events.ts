'use client';

import type { DesignEvent, DesignEventKind, LayoutArchetypeId } from '@garden-studio/schema';
import { recordDesignEvents } from '@/lib/plan-api';

/**
 * Telling the server what the user did with the design it offered them.
 *
 * The design agent can say how good it thinks a plan is; it has never had any way to find out
 * whether it was right. Every number in the evaluation harness is the scorer marking the
 * generator's homework against rules the same author wrote. These events are the only outside
 * opinion the project can collect short of a user study: which of three concepts somebody took, and
 * what they changed about it straight afterwards.
 *
 * Four rules, and each one is a way telemetry usually goes wrong.
 *
 * **It cannot break anything.** Every path swallows its own failure. An emitter is called from
 * inside a store action that a user is waiting on, so a rejected fetch must not surface as a
 * broken drag — a measurement that damages the thing it measures is worth less than no measurement.
 *
 * **It never blocks.** Nothing here is awaited by a caller and nothing returns a value worth
 * reading. `void` on the call is deliberate rather than sloppy.
 *
 * **It is batched and flushed on a timer.** Dragging three elements in ten seconds is three
 * events, and a request per gesture would put the network in the middle of the editor.
 *
 * **It records what changed, never where anything is.** A category and a magnitude, never a
 * position or an outline. The plan is already saved; a second copy of the geometry here could only
 * ever disagree with it.
 */

/** How long a batch waits for company before it is sent. */
const FLUSH_MS = 2_000;

/** What one request may carry, matching the endpoint's own cap. */
const MAX_BATCH = 20;

interface Pending {
  planId: string;
  events: DesignEvent[];
}

let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Which plan and which concept the events are about.
 *
 * Set once when a plan is hydrated and updated when a concept is chosen, rather than passed at
 * every call site. The alternative is every store action reaching into `concepts-store` to find the
 * strategy of the concept the editor was seeded from, which would put a telemetry dependency inside
 * a dozen functions that have no other reason to know about one.
 */
let context: { planId: string | null; conceptId?: string; strategy?: LayoutArchetypeId } = {
  planId: null,
};

export function setDesignEventContext(next: {
  planId: string | null;
  conceptId?: string;
  strategy?: LayoutArchetypeId;
}): void {
  /* A different plan means the queued events belong to the old one: send them before switching. */
  if (next.planId !== context.planId) flushDesignEvents();
  context = next;
}

export function designEventContext(): Readonly<typeof context> {
  return context;
}

/**
 * Queue one event.
 *
 * The concept and its composition are attached here rather than by each caller, because
 * `strategy` is the field that makes the whole table worth having: it is what turns "somebody
 * deleted a shed" into "people delete the shed on destination-garden plans".
 */
export function emitDesignEvent(
  kind: DesignEventKind,
  detail: Omit<DesignEvent, 'kind'> = {},
): void {
  const { planId, conceptId, strategy } = context;
  if (!planId) return;

  const event: DesignEvent = {
    kind,
    ...(conceptId ? { conceptId } : {}),
    ...(strategy ? { strategy } : {}),
    ...detail,
  };

  if (!pending || pending.planId !== planId) {
    flushDesignEvents();
    pending = { planId, events: [] };
  }

  pending.events.push(event);
  if (pending.events.length >= MAX_BATCH) {
    flushDesignEvents();
    return;
  }

  if (timer === null) timer = setTimeout(flushDesignEvents, FLUSH_MS);
}

/** Send whatever is queued. Safe to call at any time, including with nothing queued. */
export function flushDesignEvents(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const batch = pending;
  pending = null;
  if (!batch || batch.events.length === 0) return;

  /*
   * Fire and forget, and the `catch` is the whole contract. A user must never see this fail, and an
   * editor action must never fail because of it — so the rejection stops here, deliberately without
   * a retry. A dropped batch costs one datum; a retry queue would cost a user's afternoon the day
   * the server is down.
   */
  void recordDesignEvents(batch.planId, batch.events.slice(0, MAX_BATCH)).catch(() => {});
}

/** Drops anything queued without sending it. For tests, and for a plan being torn down. */
export function resetDesignEvents(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
  context = { planId: null };
}
