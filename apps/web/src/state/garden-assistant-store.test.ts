import type { GardenProposal } from '@garden-studio/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/plan-api';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import { resetFeaturesStoreForTests, useFeaturesStore } from './features-store';
import {
  latestGardenSuggestions,
  resetGardenAssistantStoreForTests,
  useGardenAssistantStore,
} from './garden-assistant-store';
import { setProjectRevision } from './revision';

/*
 * Same two mocks as `assistant-store.test.ts`, for the same two reasons. The API client, so a test
 * can hand back a proposal or a status code without a server; and `flushAll`, so the ordering
 * assertion below has something to observe — the flush is the part of `send` that is easy to delete
 * by accident and impossible to notice, because the only symptom is the assistant reasoning about a
 * slightly older garden and cheerfully putting a second shed on top of the first.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, proposeGardenChanges: vi.fn() };
});

vi.mock('./project-sync', () => ({ flushAll: vi.fn() }));

const api = await import('@/lib/plan-api');
const sync = await import('./project-sync');
const proposeGardenChanges = vi.mocked(api.proposeGardenChanges);
const flushAll = vi.mocked(sync.flushAll);

let calls: string[] = [];

const store = () => useGardenAssistantStore.getState();
const features = () => useFeaturesStore.getState();

function proposal(over: Partial<GardenProposal> = {}): GardenProposal {
  return {
    reply: 'Added a shed.',
    changes: [],
    scope: null,
    suggestions: ['There is a patio too'],
    unplaceable: [],
    ...over,
  };
}

function addChange(id: string, at: { x: number; y: number }) {
  return {
    id,
    kind: 'add' as const,
    featureId: null,
    label: 'Shed',
    next: {
      id: `ai-${id}`,
      kind: 'shed' as const,
      name: 'Shed',
      geometry: { kind: 'rect' as const, centre: at, width: 2.5, depth: 2, rotation: 0 },
      status: 'keep' as const,
      replaceWith: null,
    },
    previous: null,
  };
}

/** Step 1's output: a 20 × 16 m plot with an 8 × 6 m house in the middle. */
function mapProperty(): void {
  const boundary = useBoundaryStore.getState();
  boundary.addVertexAt({ x: 0, y: 0 });
  boundary.addVertexAt({ x: 20, y: 0 });
  boundary.addVertexAt({ x: 20, y: 16 });
  boundary.addVertexAt({ x: 0, y: 16 });
  boundary.closeShape();
  useBoundaryStore.getState().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

beforeEach(() => {
  calls = [];
  resetGardenAssistantStoreForTests();
  resetFeaturesStoreForTests();
  resetBoundaryStoreForTests();
  setProjectRevision({ projectId: 'plan-1', revision: 3 });
  mapProperty();

  flushAll.mockReset();
  flushAll.mockImplementation(async () => {
    calls.push('flush');
  });

  proposeGardenChanges.mockReset();
  proposeGardenChanges.mockImplementation(async () => {
    calls.push('propose');
    return proposal();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('sending', () => {
  it('flushes unsaved edits before asking', async () => {
    await store().send('there is a shed');

    expect(calls).toEqual(['flush', 'propose']);
  });

  it('sends only the sentence, against the loaded plan', async () => {
    await store().send('there is a shed');

    expect(proposeGardenChanges).toHaveBeenCalledWith('plan-1', 'there is a shed');
  });

  it('ignores an empty message', async () => {
    await store().send('   ');

    expect(proposeGardenChanges).not.toHaveBeenCalled();
    expect(store().messages).toEqual([]);
  });

  it('keeps the user’s words in the log even when the reply fails', async () => {
    proposeGardenChanges.mockRejectedValueOnce(new ApiError(503, 'nope'));

    await store().send('there is a shed');

    expect(store().messages).toHaveLength(1);
    expect(store().messages[0].role).toBe('user');
  });

  /*
   * No assistant bubble on failure. An invented reply in the transcript would be indistinguishable
   * from one the model actually wrote, which is the one thing that would make the log worthless.
   */
  it('reports a failure as an error rather than as a reply', async () => {
    proposeGardenChanges.mockRejectedValueOnce(new ApiError(503, 'nope'));

    await store().send('there is a shed');

    expect(store().error).toMatch(/unavailable/i);
    expect(store().messages.some((message) => message.role === 'assistant')).toBe(false);
  });

  it('names the 429 and the 502 differently from a dead connection', async () => {
    proposeGardenChanges.mockRejectedValueOnce(new ApiError(429, 'slow down'));
    await store().send('one');
    expect(store().error).toMatch(/minute/i);

    proposeGardenChanges.mockRejectedValueOnce(new ApiError(502, 'bad'));
    await store().send('two');
    expect(store().error).toMatch(/rephras/i);
  });
});

describe('applying', () => {
  // The headline behaviour: the canvas changes at once, with no review step in between.
  it('puts the changes on the plan straight away', async () => {
    proposeGardenChanges.mockResolvedValueOnce(
      proposal({ changes: [addChange('c1', { x: 4, y: 4 })] }),
    );

    await store().send('there is a shed');

    expect(features().present.features).toHaveLength(1);
    expect(features().present.features[0].name).toBe('Shed');
  });

  it('records what landed and what the plan turned down', async () => {
    proposeGardenChanges.mockResolvedValueOnce(
      proposal({
        changes: [addChange('good', { x: 4, y: 4 }), addChange('over', { x: 19.9, y: 8 })],
      }),
    );

    await store().send('two sheds');

    const reply = store().messages.at(-1);
    expect(reply?.role).toBe('assistant');
    if (reply?.role !== 'assistant') throw new Error('expected a reply');

    expect(reply.appliedIds).toEqual(['good']);
    expect(reply.refused).toHaveLength(1);
  });

  // One sentence is one Undo, which is the whole contract of `applyAssistantChanges`.
  it('leaves one undo entry for the whole turn', async () => {
    proposeGardenChanges.mockResolvedValueOnce(
      proposal({
        changes: [
          addChange('c1', { x: 4, y: 4 }),
          addChange('c2', { x: 9, y: 4 }),
          addChange('c3', { x: 14, y: 4 }),
        ],
      }),
    );

    const before = features().past.length;
    await store().send('three sheds');

    expect(features().present.features).toHaveLength(3);
    expect(features().past.length).toBe(before + 1);

    features().undo();
    expect(features().present.features).toHaveLength(0);
  });

  it('applies a scope change to the boundary store', async () => {
    proposeGardenChanges.mockResolvedValueOnce(
      proposal({ scope: { zones: ['back'] }, reply: 'Redesigning the back garden.' }),
    );

    await store().send('just the back garden');

    expect(useBoundaryStore.getState().present.selectedZoneIds).toEqual(['back']);
  });

  it('leaves the plan alone when the assistant proposed nothing', async () => {
    await store().send('what can you do?');

    expect(features().present.features).toEqual([]);
    expect(store().messages.at(-1)?.role).toBe('assistant');
  });
});

describe('suggestions', () => {
  it('opens with prompts phrased as things a person would say', () => {
    const opening = latestGardenSuggestions({ messages: [] });

    expect(opening.length).toBeGreaterThan(0);
    expect(opening[0]).toMatch(/there is|i have|two|only/i);
  });

  it('prefers the newest set the server sent', async () => {
    proposeGardenChanges.mockResolvedValueOnce(proposal({ suggestions: ['And a greenhouse'] }));
    await store().send('there is a shed');

    expect(latestGardenSuggestions({ messages: store().messages })).toEqual(['And a greenhouse']);
  });
});
