import type { DesignEvent } from '@garden-studio/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  designEventContext,
  emitDesignEvent,
  flushDesignEvents,
  resetDesignEvents,
  setDesignEventContext,
} from './design-events';

/*
 * Typed with the real signature, not inferred from the stub body. `vi.fn(() => …)` gives a mock
 * whose `calls` is a zero-length tuple, so every `calls[0]![1]` below is a type error — and one
 * `next build` catches while `tsc --noEmit` on the app's own config does not.
 */
const recordDesignEvents = vi.hoisted(() =>
  vi.fn((_planId: string, _events: DesignEvent[]) => Promise.resolve({ recorded: 1 })),
);
vi.mock('@/lib/plan-api', () => ({ recordDesignEvents }));

/**
 * The emitter, tested for the two things that would make it harmful rather than useless.
 *
 * Useless is survivable: a dropped batch costs one datum. Harmful is not — an emitter that throws
 * out of a store action breaks a drag, and one that fires per mousemove puts the network in the
 * middle of the editor. Both are asserted here rather than left to the comments.
 */
describe('emitting design events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordDesignEvents.mockClear();
    recordDesignEvents.mockImplementation(() => Promise.resolve({ recorded: 1 }));
    resetDesignEvents();
  });

  afterEach(() => {
    resetDesignEvents();
    vi.useRealTimers();
  });

  it('sends nothing at all until a plan is known', () => {
    emitDesignEvent('plan_exported');
    flushDesignEvents();

    expect(recordDesignEvents).not.toHaveBeenCalled();
  });

  it('batches a burst into one request', () => {
    setDesignEventContext({ planId: 'p1' });

    emitDesignEvent('element_moved', { elementId: 'e1', delta: 1.2 });
    emitDesignEvent('element_moved', { elementId: 'e2', delta: 0.4 });
    emitDesignEvent('element_deleted', { elementId: 'e3' });

    /* Nothing yet: a request per gesture would put the network in the middle of a drag. */
    expect(recordDesignEvents).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);

    expect(recordDesignEvents).toHaveBeenCalledTimes(1);
    const [planId, events] = recordDesignEvents.mock.calls[0]!;
    expect(planId).toBe('p1');
    expect(events).toHaveLength(3);
  });

  /**
   * The field that makes the whole table worth having: it is what turns "somebody deleted a shed"
   * into "people delete the shed on destination-garden plans".
   */
  it('stamps every event with the concept and composition being edited', () => {
    setDesignEventContext({
      planId: 'p1',
      conceptId: 'c11-2',
      strategy: 'destination_garden',
    });

    emitDesignEvent('element_deleted', { elementId: 'e9', category: 'structure' });
    flushDesignEvents();

    const [, events] = recordDesignEvents.mock.calls[0]!;
    expect(events[0]).toEqual({
      kind: 'element_deleted',
      conceptId: 'c11-2',
      strategy: 'destination_garden',
      elementId: 'e9',
      category: 'structure',
    });
  });

  it('sends a full batch immediately rather than waiting', () => {
    setDesignEventContext({ planId: 'p1' });
    for (let i = 0; i < 20; i += 1) emitDesignEvent('element_moved', { elementId: `e${i}` });

    expect(recordDesignEvents).toHaveBeenCalledTimes(1);
    expect(recordDesignEvents.mock.calls[0]![1]).toHaveLength(20);
  });

  /**
   * A queued batch belongs to the plan it was recorded against. Switching plans without flushing
   * would file one garden's events under another, which is worse than losing them.
   */
  it('flushes the old plan before adopting a new one', () => {
    setDesignEventContext({ planId: 'p1' });
    emitDesignEvent('plan_exported');

    setDesignEventContext({ planId: 'p2' });

    expect(recordDesignEvents).toHaveBeenCalledTimes(1);
    expect(recordDesignEvents.mock.calls[0]![0]).toBe('p1');
  });

  it('remembers the context it was given', () => {
    setDesignEventContext({ planId: 'p1', conceptId: 'c1', strategy: 'formal_axis' });
    expect(designEventContext()).toEqual({
      planId: 'p1',
      conceptId: 'c1',
      strategy: 'formal_axis',
    });
  });

  /**
   * The contract. An emitter is called from inside a store action a user is waiting on, so a
   * rejected request must not surface as a broken drag — a measurement that damages the thing it
   * measures is worth less than no measurement.
   */
  it('never throws when the request fails', async () => {
    recordDesignEvents.mockImplementation(() => Promise.reject(new Error('offline')));
    setDesignEventContext({ planId: 'p1' });

    expect(() => {
      emitDesignEvent('plan_exported');
      flushDesignEvents();
    }).not.toThrow();

    /* And the rejection is settled rather than left to become an unhandled rejection. */
    await vi.runAllTimersAsync();
  });

  it('does nothing when asked to flush with nothing queued', () => {
    setDesignEventContext({ planId: 'p1' });
    flushDesignEvents();
    flushDesignEvents();

    expect(recordDesignEvents).not.toHaveBeenCalled();
  });
});
