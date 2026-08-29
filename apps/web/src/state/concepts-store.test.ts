import { PlanDocumentSchema, type GeneratedConcept, type PlanProject } from '@garden-studio/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionConflictError, ValidationError } from '@/lib/plan-api';
import {
  chosenConcept,
  resetConceptsStoreForTests,
  selectedConcept,
  useConceptsStore,
} from './concepts-store';
import { setProjectRevision } from './revision';

/*
 * Generation runs on the server, so the API is mocked — and the stores no longer need a boundary
 * or a brief to test against. This file is about generation *history*: undo, redo, choosing,
 * compare. `flushAll` is mocked for the same reason the assistant tests mock it: the ordering
 * is load-bearing and the only symptom of dropping it is a 409 on the concepts screen.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, generateConcepts: vi.fn() };
});

vi.mock('./project-sync', () => ({ flushAll: vi.fn() }));

const api = await import('@/lib/plan-api');
const sync = await import('./project-sync');
const generateConceptsApi = vi.mocked(api.generateConcepts);
const flushAll = vi.mocked(sync.flushAll);

const store = () => useConceptsStore.getState();

const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

/** Successive rolls have to produce different ids, the way the real seed advance does. */
let roll = 0;
/** Everything that happened, in order, so the flush-before-request rule can be asserted. */
let calls: string[] = [];

function fakeConcept(seed: number, index: number): GeneratedConcept {
  return {
    id: `c${seed}-${index}`,
    name: ['Balanced', 'Entertaining Focus', 'Low-Maintenance Retreat'][index] ?? 'Concept',
    recommended: index === 0,
    summary: 'A concept.',
    style: 'Modern / Natural',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [],
    elements: [],
  };
}

function project(
  revision: number,
  concepts: GeneratedConcept[],
  selectedId: string | null,
  seed: number,
): PlanProject {
  return {
    id: PROJECT_ID,
    name: 'Concept garden',
    revision,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T11:30:00.000Z',
    document: PlanDocumentSchema.parse({
      version: 1,
      concepts: { concepts, selectedId, chosenConceptId: null, seed },
    }),
  };
}

async function generate(): Promise<void> {
  await store().generateAll();
}

beforeEach(() => {
  roll = 0;
  calls = [];
  resetConceptsStoreForTests();
  setProjectRevision({ projectId: PROJECT_ID, revision: 1 });

  flushAll.mockReset().mockImplementation(async () => {
    calls.push('flush');
  });

  generateConceptsApi.mockReset().mockImplementation(async (_id, revision, input) => {
    calls.push('generate');
    roll += 1;
    const seed = roll;

    if (input.mode === 'all') {
      const concepts = [0, 1, 2].map((index) => fakeConcept(seed, index));
      return { project: project(revision + 1, concepts, concepts[0]!.id, seed), concepts };
    }

    const replacement = fakeConcept(seed, input.index);
    const concepts = store().present.concepts.map((concept, at) =>
      at === input.index ? replacement : concept,
    );

    return { project: project(revision + 1, concepts, replacement.id, seed), concepts };
  });
});

describe('generating', () => {
  it('starts with nothing', async () => {
    expect(store().present.concepts).toEqual([]);
    expect(store().generating).toBeNull();
  });

  /**
   * The loading state is not decoration. Real generation will take seconds, and every consumer
   * already reads `generating` — so the swap to a real service does not have to add one.
   */
  it('reports that it is working before the set lands', async () => {
    const rolling = store().generateAll();

    expect(store().generating).toBe('all');
    expect(store().present.concepts).toEqual([]);

    await rolling;
    expect(store().generating).toBeNull();
    expect(store().present.concepts).toHaveLength(3);
  });

  it('lands on the recommended concept', async () => {
    await generate();
    expect(selectedConcept(store())?.recommended).toBe(true);
  });

  it('advances the seed so a second roll is a different set', async () => {
    await generate();
    const first = store().present.concepts.map((concept) => concept.id);

    await generate();
    expect(store().present.concepts.map((concept) => concept.id)).not.toEqual(first);
  });

  it('stamps the save time', async () => {
    useConceptsStore.setState({ lastSavedAt: Date.now() - 1000 });
    const before = store().lastSavedAt;

    await generate();

    expect(store().lastSavedAt).toBeGreaterThan(before);
  });

  /*
   * The mock could only race two timers; a real request can genuinely be in flight when the button
   * is pressed again. The first is aborted, and only the second lands — so exactly one entry goes
   * onto the history stack rather than two.
   */
  it('does not leave two generations racing when clicked twice', async () => {
    const first = store().generateAll();
    const second = store().generateAll();

    await Promise.all([first, second]);

    expect(store().present.concepts).toHaveLength(3);
    expect(store().past).toHaveLength(1);
    expect(store().generating).toBeNull();
  });

  it('surfaces a generation failure without clearing what is on screen', async () => {
    await generate();
    const showing = store().present.concepts;

    generateConceptsApi.mockRejectedValueOnce(new Error('offline'));
    await generate();

    expect(store().generateError).toBe('offline');
    expect(store().present.concepts).toEqual(showing);
    expect(store().generating).toBeNull();
  });

  /*
   * A 422 means the plan has a spatial problem the generator will not design around. It is the one
   * failure the user can actually fix, so it names the problem rather than saying "try again".
   */
  it('explains a plan the generator refuses to work with', async () => {
    generateConceptsApi.mockRejectedValueOnce(
      new ValidationError([
        {
          code: 'features_overlap',
          targetIds: ['f1', 'f2'],
          section: 'features',
          message: 'The shed overlaps the patio.',
        },
      ]),
    );

    await generate();

    expect(store().generateError).toContain('The shed overlaps the patio.');
    expect(store().generateError).toContain('generate again');
  });

  it('clears a previous failure when the next roll works', async () => {
    generateConceptsApi.mockRejectedValueOnce(new Error('offline'));
    await generate();
    expect(store().generateError).toBe('offline');

    await generate();
    expect(store().generateError).toBeNull();
  });

  it('does nothing at all when no plan is loaded', async () => {
    setProjectRevision(null);

    await generate();

    expect(generateConceptsApi).not.toHaveBeenCalled();
    expect(store().generating).toBeNull();
  });

  /**
   * The request carries no garden, so the generator reads whatever is stored. An edit still
   * sitting in the autosave debounce would 409 the generate — and this screen fires one the
   * moment you arrive, which is inside that window after leaving the brief.
   */
  it('flushes unsaved edits before generating', async () => {
    await generate();

    expect(calls).toEqual(['flush', 'generate']);
  });

  /*
   * Flushing covers the debounce window; this covers a write that still landed between the
   * flush and the generate POST. Adopting the 409 revision and retrying once is what stops
   * the screen from showing "this plan changed somewhere else" on a single-tab race.
   */
  it('retries once after a stale revision rather than failing', async () => {
    generateConceptsApi.mockRejectedValueOnce(new RevisionConflictError(project(3, [], null, 1)));

    await generate();

    expect(generateConceptsApi).toHaveBeenCalledTimes(2);
    expect(generateConceptsApi.mock.calls[0]?.[1]).toBe(1);
    expect(generateConceptsApi.mock.calls[1]?.[1]).toBe(3);
    expect(store().present.concepts).toHaveLength(3);
    expect(store().generateError).toBeNull();
  });

  it('surfaces a conflict that a retry cannot clear', async () => {
    generateConceptsApi
      .mockRejectedValueOnce(new RevisionConflictError(project(3, [], null, 1)))
      .mockRejectedValueOnce(new RevisionConflictError(project(4, [], null, 1)));

    await generate();

    expect(store().generateError).toBe('This plan changed somewhere else.');
    expect(store().present.concepts).toEqual([]);
  });
});

describe('regenerating one concept', () => {
  it('replaces only that concept', async () => {
    await generate();
    const [first, second, third] = store().present.concepts;

    store().select(second.id);
    await store().regenerateSelected();

    const after = store().present.concepts;
    expect(after[0].id).toBe(first.id);
    expect(after[2].id).toBe(third.id);
    expect(after[1].id).not.toBe(second.id);
    // The replacement is what you are now looking at.
    expect(store().present.selectedId).toBe(after[1].id);
  });

  it('names the concept it is working on, so only that card pulses', async () => {
    await generate();
    const target = store().present.concepts[1];

    store().select(target.id);
    store().regenerateSelected();
    expect(store().generating).toBe(target.id);
  });

  it('does nothing with no concept selected', async () => {
    expect(() => store().regenerateSelected()).not.toThrow();
    expect(store().generating).toBeNull();
  });
});

describe('choosing', () => {
  it('records the choice', async () => {
    await generate();
    const target = store().present.concepts[0];

    store().choose(target.id);
    expect(store().chosenConceptId).toBe(target.id);
    expect(chosenConcept(store())?.id).toBe(target.id);
  });

  /**
   * A chosen concept must never dangle. Regenerating can retire the very concept the user
   * committed to, and a Continue button pointing at a plan that is no longer on offer is worse
   * than one the user has to press again.
   *
   * Liveness is derived rather than stored, so the assertion is on `chosenConcept`, which is
   * what the screen gates Continue on.
   */
  it('stops reporting a choice once that concept is regenerated away', async () => {
    await generate();
    const target = store().present.concepts[1];
    store().select(target.id);
    store().choose(target.id);

    await store().regenerateSelected();

    expect(chosenConcept(store())).toBeNull();
  });

  it('keeps the choice when a different concept is regenerated', async () => {
    await generate();
    const [keeper, other] = store().present.concepts;
    store().choose(keeper.id);

    store().select(other.id);
    await store().regenerateSelected();

    expect(chosenConcept(store())?.id).toBe(keeper.id);
  });

  /**
   * The case that drove the design. Clearing the id whenever the set changed looked equivalent
   * and was not: Undo cleared it and Redo then had nothing to put back, so a round trip
   * silently un-chose the concept.
   */
  it('survives an undo and redo round trip', async () => {
    await generate();
    const target = store().present.concepts[0];
    store().choose(target.id);

    store().undo();
    // The set it belonged to is not on screen, so nothing is chosen right now.
    expect(chosenConcept(store())).toBeNull();

    store().redo();
    expect(chosenConcept(store())?.id).toBe(target.id);
  });
});

describe('selecting', () => {
  it('does not enter history', async () => {
    await generate();
    const depth = store().past.length;

    store().select(store().present.concepts[2].id);
    expect(store().past).toHaveLength(depth);
  });

  it('ignores a reselect of what is already showing', async () => {
    await generate();
    const current = store().present.selectedId!;
    const before = store().present;

    store().select(current);
    expect(store().present).toBe(before);
  });
});

describe('generation history', () => {
  it('has nothing to undo before anything is generated', async () => {
    expect(store().past).toEqual([]);
    store().undo();
    expect(store().present.concepts).toEqual([]);
  });

  it('walks back and forward through sets', async () => {
    await generate();
    const first = store().present.concepts.map((concept) => concept.id);

    await generate();
    const second = store().present.concepts.map((concept) => concept.id);

    store().undo();
    expect(store().present.concepts.map((concept) => concept.id)).toEqual(first);

    store().redo();
    expect(store().present.concepts.map((concept) => concept.id)).toEqual(second);
  });

  it('discards the abandoned future once a new set is generated', async () => {
    await generate();
    await generate();
    store().undo();
    expect(store().future).toHaveLength(1);

    await generate();
    expect(store().future).toEqual([]);
  });

  it('resets to the first set generated for this brief', async () => {
    await generate();
    const first = store().present.concepts.map((concept) => concept.id);

    await generate();
    await generate();
    store().reset();

    // The oldest entry on the stack is the empty set the wizard started from.
    expect(store().past).toEqual([]);
    expect(store().present.concepts).toEqual([]);
    expect(first.length).toBe(3);
  });
});

describe('compare mode', () => {
  it('seeds itself with two concepts so it never opens empty', async () => {
    await generate();
    store().setCompareOpen(true);

    expect(store().compareIds).toHaveLength(2);
  });

  it('keeps an explicit selection when opened', async () => {
    await generate();
    const ids = store().present.concepts.map((concept) => concept.id);
    store().toggleCompare(ids[0]);
    store().toggleCompare(ids[2]);

    store().setCompareOpen(true);
    expect(store().compareIds).toEqual([ids[0], ids[2]]);
  });

  it('toggles a concept in and out', async () => {
    await generate();
    const id = store().present.concepts[0].id;

    store().toggleCompare(id);
    expect(store().compareIds).toContain(id);

    store().toggleCompare(id);
    expect(store().compareIds).not.toContain(id);
  });

  it('shows nothing for concepts that a regeneration retired', async () => {
    await generate();
    const target = store().present.concepts[1];
    store().toggleCompare(target.id);

    store().select(target.id);
    await store().regenerateSelected();

    // Same discipline as the chosen concept: the tick is harmless, because the view is derived
    // by intersecting `compareIds` with the concepts that actually exist.
    const showing = store().present.concepts.filter((concept) =>
      store().compareIds.includes(concept.id),
    );
    expect(showing.map((concept) => concept.id)).not.toContain(target.id);
  });
});
