import { leavesOf, type AssistantProposal, type DesignRun } from '@garden-studio/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/plan-api';
import {
  latestSuggestions,
  resetAssistantStoreForTests,
  useAssistantStore,
  type AssistantMessage,
} from './assistant-store';
import { useAiRunStore } from './ai-run-store';
import { setProjectRevision } from './revision';

/*
 * Two things are mocked, for two different reasons. The API client, so a test can hand back a
 * proposal or a status code without a server; and `flushAll`, so the ordering assertion below has
 * something to observe — the flush is the part of `send` that is easy to delete by accident and
 * impossible to notice, because the only symptom is an assistant answering about a slightly older
 * garden.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, proposeChanges: vi.fn() };
});

vi.mock('./project-sync', () => ({ flushAll: vi.fn() }));

const api = await import('@/lib/plan-api');
const sync = await import('./project-sync');
const proposeChanges = vi.mocked(api.proposeChanges);
const flushAll = vi.mocked(sync.flushAll);

/** Everything that happened, in order, so the flush-before-request rule can be asserted. */
let calls: string[] = [];

function proposal(over: Partial<AssistantProposal> = {}): AssistantProposal {
  return {
    reply: 'I have proposed one change.',
    changes: [],
    suggestions: ['Make it cheaper', 'More lawn', 'Add privacy'],
    unplaceable: [],
    ...over,
  };
}

const store = () => useAssistantStore.getState();

function assistantMessages(): AssistantMessage[] {
  return store().messages.filter(
    (message): message is AssistantMessage => message.role === 'assistant',
  );
}

beforeEach(() => {
  calls = [];
  resetAssistantStoreForTests();
  setProjectRevision({ projectId: 'p-1', revision: 4 });

  flushAll.mockReset().mockImplementation(async () => {
    calls.push('flush');
  });

  proposeChanges.mockReset().mockImplementation(async () => {
    calls.push('propose');
    return proposal();
  });
});

afterEach(() => {
  setProjectRevision(null);
});

describe('sending', () => {
  it('shows the question immediately and the answer when it arrives', async () => {
    await store().send('make the patio bigger');

    expect(store().messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(store().messages[0].text).toBe('make the patio bigger');
    expect(store().pending).toBe(false);
  });

  it('sends only the sentence, against the loaded plan', async () => {
    await store().send('  use gravel instead of paving  ');

    expect(proposeChanges).toHaveBeenCalledWith('p-1', 'use gravel instead of paving');
  });

  /**
   * The request carries no geometry, so the assistant reads whatever is stored. An edit still
   * sitting in the autosave debounce would mean it answers about a garden the user cannot see.
   */
  it('flushes unsaved edits before asking', async () => {
    await store().send('make the patio bigger');

    expect(calls).toEqual(['flush', 'propose']);
  });

  it('ignores an empty message and a second send while one is in flight', async () => {
    await store().send('   ');
    expect(proposeChanges).not.toHaveBeenCalled();

    const first = store().send('make the patio bigger');
    await store().send('and add a shed');
    await first;

    expect(proposeChanges).toHaveBeenCalledTimes(1);
  });

  it('ticks every proposed line to start with', async () => {
    const element = {
      id: 'p1',
      category: 'paved-area' as const,
      role: 'feature' as const,
      name: 'Seating patio',
      shape: {
        kind: 'rect' as const,
        centre: { x: 3, y: 3 },
        width: 3,
        depth: 2,
        rotation: 0,
      },
      zone: 'left' as const,
    };

    proposeChanges.mockResolvedValue(
      proposal({
        changes: [
          {
            id: 'c1',
            kind: 'resize',
            elementId: 'p1',
            label: 'Seating patio',
            before: '3.0 × 2.0 m',
            after: '3.8 × 2.5 m',
            previous: element,
            next: element,
          },
        ],
      }),
    );

    await store().send('make the patio bigger');

    expect(assistantMessages()[0].accepted).toEqual({ c1: true });
  });

  it('keeps what could not be placed, with the planner’s reason', async () => {
    proposeChanges.mockResolvedValue(
      proposal({
        unplaceable: [
          {
            description: 'Shed 2.0 × 1.5 m',
            reason: 'There is no clear space in the front garden.',
          },
        ],
      }),
    );

    await store().send('put a shed in the front garden');

    expect(assistantMessages()[0].unplaceable).toHaveLength(1);
  });
});

describe('when the assistant cannot answer', () => {
  it('reads a 503 as switched off rather than broken', async () => {
    proposeChanges.mockRejectedValue(new ApiError(503, 'Request failed with 503.'));

    await store().send('make the patio bigger');

    expect(store().error).toContain('unavailable');
  });

  it('says something different about being rate limited', async () => {
    proposeChanges.mockRejectedValue(new ApiError(429, 'Request failed with 429.'));

    await store().send('make the patio bigger');

    expect(store().error).toContain('try again');
  });

  /**
   * No assistant bubble on failure. A fabricated reply in the log would be indistinguishable from
   * one the model wrote, and the log is the record of how the plan got this way.
   */
  it('adds no reply to the transcript and stops pending', async () => {
    proposeChanges.mockRejectedValue(new ApiError(502, 'Request failed with 502.'));

    await store().send('make the patio bigger');

    expect(assistantMessages()).toEqual([]);
    expect(store().pending).toBe(false);
  });

  it('does not ask at all when no plan is loaded', async () => {
    setProjectRevision(null);

    await store().send('make the patio bigger');

    expect(proposeChanges).not.toHaveBeenCalled();
    expect(store().error).not.toBeNull();
  });

  it('clears the error on the next attempt', async () => {
    proposeChanges.mockRejectedValueOnce(new ApiError(503, 'Request failed with 503.'));
    await store().send('make the patio bigger');
    expect(store().error).not.toBeNull();

    await store().send('try again');
    expect(store().error).toBeNull();
  });
});

describe('suggestions', () => {
  it('opens with a generic set and then follows the latest reply', async () => {
    const opening = latestSuggestions(store());
    expect(opening.length).toBeGreaterThanOrEqual(3);

    await store().send('make the patio bigger');

    expect(latestSuggestions(store())).toEqual(['Make it cheaper', 'More lawn', 'Add privacy']);
  });

  /** Zustand v5 compares snapshots by identity, so the opening set must not be rebuilt per call. */
  it('returns a stable opening array', () => {
    expect(latestSuggestions(store())).toBe(latestSuggestions(store()));
  });
});

describe('watching the changes instead of applying them', () => {
  const patio = {
    id: 'e-1', category: 'paved-area', role: 'feature', name: 'Seating patio', zone: 'back',
    shape: { kind: 'rect', centre: { x: 6, y: 6 }, width: 4, depth: 3, rotation: 0 },
  };
  const change = {
    id: 'ch1', kind: 'resize', elementId: 'e-1', label: 'Seating patio',
    before: '12 m²', after: '20 m²',
    previous: patio,
    next: { ...patio, shape: { kind: 'rect', centre: { x: 6, y: 6 }, width: 5, depth: 4, rotation: 0 } },
  };

  async function answered() {
    proposeChanges.mockResolvedValue(proposal({ changes: [change as never] }));
    await store().send('Make the terrace bigger');
    return assistantMessages()[0]!;
  }

  it('hands the accepted lines to the run rather than to the editor', async () => {
    const message = await answered();
    const started = vi.fn((_run: DesignRun) => ({ ok: true as const }));
    vi.spyOn(useAiRunStore.getState(), 'start').mockImplementation(started);

    store().playMessage(message.id);

    expect(started).toHaveBeenCalledTimes(1);
    const run = started.mock.calls[0]![0];
    // The same edit, as operations: no second request and nothing new on the wire.
    expect(run.operations.flatMap(leavesOf).map((leaf) => leaf.kind)).toEqual(['select', 'resize']);
  });

  it('closes the diff once the run owns the changes', async () => {
    const message = await answered();
    vi.spyOn(useAiRunStore.getState(), 'start').mockImplementation(() => ({ ok: true }));

    store().playMessage(message.id);

    // Leaving Apply live beside a run already performing them invites the plan changing twice.
    expect(assistantMessages()[0]!.applied).toBe(true);
    expect(assistantMessages()[0]!.appliedIds).toEqual(['ch1']);
  });

  it('leaves the diff alone when the run was refused', async () => {
    const message = await answered();
    vi.spyOn(useAiRunStore.getState(), 'start').mockImplementation(() => ({
      ok: false, reason: 'A redesign is already running.',
    }));

    store().playMessage(message.id);

    expect(assistantMessages()[0]!.applied).toBe(false);
  });
});
