import { PlanDocumentSchema, type PlanProject } from '@garden-studio/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionConflictError } from '@/lib/plan-api';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import { resetBriefStoreForTests, useBriefStore } from './brief-store';
import { resetConceptsStoreForTests } from './concepts-store';
import { resetFeaturesStoreForTests, useFeaturesStore } from './features-store';
import { resetPlanEditorStoreForTests } from './plan-editor-store';
import { flushAll, selectSaving, startProjectSync, useSyncStore } from './project-sync';

/*
 * The API client is mocked rather than `fetch`: the interesting behaviour here is debouncing,
 * queueing and conflict adoption, and asserting on request bodies would only re-test the client.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');

  return {
    ...actual,
    patchSite: vi.fn(),
    patchFeatures: vi.fn(),
    patchBrief: vi.fn(),
    patchLayout: vi.fn(),
    patchConceptSelection: vi.fn(),
  };
});

const api = await import('@/lib/plan-api');
const patchSite = vi.mocked(api.patchSite);
const patchFeatures = vi.mocked(api.patchFeatures);
const patchBrief = vi.mocked(api.patchBrief);

function project(revision = 1, overrides: Partial<PlanProject> = {}): PlanProject {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Synced garden',
    revision,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T11:30:00.000Z',
    document: PlanDocumentSchema.parse({ version: 1 }),
    ...overrides,
  };
}

/** What a section PATCH resolves to. */
function saved(revision: number, violations: never[] = []) {
  return { project: project(revision), violations };
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetBoundaryStoreForTests();
  resetFeaturesStoreForTests();
  resetBriefStoreForTests();
  resetConceptsStoreForTests();
  resetPlanEditorStoreForTests();

  patchSite.mockReset().mockResolvedValue(saved(2));
  patchFeatures.mockReset().mockResolvedValue(saved(2));
  patchBrief.mockReset().mockResolvedValue(saved(2));

  // Also loads the plan into the stores — the two are one call so the subscriptions cannot see
  // the load as an edit.
  stop = startProjectSync(project(1));
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('debouncing', () => {
  it('coalesces a burst of edits into one request', async () => {
    const boundary = useBoundaryStore.getState();
    boundary.addVertexAt({ x: 0, y: 0 });
    boundary.addVertexAt({ x: 10, y: 0 });
    boundary.addVertexAt({ x: 10, y: 8 });

    expect(patchSite).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(patchSite).toHaveBeenCalledTimes(1);
  });

  it('sends nothing at all when only ephemeral state changes', async () => {
    useBoundaryStore.getState().setBoundaryTool('move');
    useBoundaryStore.getState().toggleSnap();

    await vi.runAllTimersAsync();

    expect(patchSite).not.toHaveBeenCalled();
  });

  it('sends each section to its own endpoint', async () => {
    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    useBriefStore.getState().setBudget('medium');

    await vi.runAllTimersAsync();

    expect(patchSite).toHaveBeenCalledTimes(1);
    expect(patchBrief).toHaveBeenCalledTimes(1);
  });

  /*
   * `skipped` sits outside the features store's history stack, so a subscription watching only
   * `present` would never save it.
   */
  it('saves the features section when only "nothing to add" is ticked', async () => {
    useFeaturesStore.getState().setSkipped(true);

    await vi.runAllTimersAsync();

    expect(patchFeatures).toHaveBeenCalledTimes(1);
  });
});

describe('revision handling', () => {
  it('bases each write on the revision the last one returned', async () => {
    patchSite.mockResolvedValueOnce(saved(2)).mockResolvedValueOnce(saved(3));

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();

    useBoundaryStore.getState().addVertexAt({ x: 5, y: 0 });
    await vi.runAllTimersAsync();

    expect(patchSite.mock.calls[0]![1]).toBe(1);
    expect(patchSite.mock.calls[1]![1]).toBe(2);
  });

  it('adopts the server version on a conflict', async () => {
    const theirs = project(9, {
      name: 'Their garden',
      document: PlanDocumentSchema.parse({
        version: 1,
        site: {
          vertices: [
            { id: 'v1', x: 0, y: 0 },
            { id: 'v2', x: 4, y: 0 },
            { id: 'v3', x: 4, y: 4 },
          ],
          closed: true,
        },
      }),
    });

    patchSite.mockRejectedValueOnce(new RevisionConflictError(theirs));

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();

    // Their plan is now what is on screen, and the error says why.
    expect(useBoundaryStore.getState().present.vertices).toHaveLength(3);
    expect(useBoundaryStore.getState().projectName).toBe('Their garden');
    expect(useSyncStore.getState().error).toContain('edited somewhere else');
  });

  /*
   * Loading looks identical to editing from a subscription's point of view. Without suppressing
   * them during the adoption, the client would send the server's own document straight back — and
   * overwrite whatever the other tab did next.
   */
  it('does not write the adopted version back to the server', async () => {
    patchSite.mockRejectedValueOnce(new RevisionConflictError(project(9)));

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();

    expect(patchSite).toHaveBeenCalledTimes(1);
    expect(patchFeatures).not.toHaveBeenCalled();
    expect(patchBrief).not.toHaveBeenCalled();
  });

  it('writes against the adopted revision after a conflict', async () => {
    patchSite
      .mockRejectedValueOnce(new RevisionConflictError(project(9)))
      .mockResolvedValueOnce(saved(10));

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();

    useBoundaryStore.getState().addVertexAt({ x: 1, y: 1 });
    await vi.runAllTimersAsync();

    expect(patchSite.mock.calls[1]![1]).toBe(9);
  });
});

describe('status', () => {
  it('reports saving while a write is outstanding, then the server timestamp', async () => {
    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });

    expect(selectSaving(useSyncStore.getState())).toBe(true);

    await vi.runAllTimersAsync();

    expect(selectSaving(useSyncStore.getState())).toBe(false);
    expect(useSyncStore.getState().savedAt).toBe(new Date('2026-08-02T11:30:00.000Z').getTime());
  });

  it('surfaces a failed save without losing the edit', async () => {
    patchSite.mockRejectedValueOnce(new Error('offline'));

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();

    expect(useSyncStore.getState().error).toBe('offline');
    expect(useBoundaryStore.getState().present.vertices).toHaveLength(1);
  });

  it('keeps a geometry violation on screen when the brief is saved afterwards', async () => {
    patchSite.mockResolvedValueOnce({
      project: project(2),
      violations: [
        {
          code: 'features_overlap',
          targetIds: ['f1', 'f2'],
          section: 'features',
          message: 'The shed overlaps the patio.',
        },
      ],
    });

    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    await vi.runAllTimersAsync();
    expect(useSyncStore.getState().violations).toHaveLength(1);

    useBriefStore.getState().setBudget('low');
    await vi.runAllTimersAsync();

    // The brief has nothing to say about geometry, so its empty list must not clear this.
    expect(useSyncStore.getState().violations).toHaveLength(1);
  });
});

describe('flushAll', () => {
  it('sends outstanding sections immediately rather than waiting for the debounce', async () => {
    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });
    useBriefStore.getState().setBudget('high');

    await flushAll();

    expect(patchSite).toHaveBeenCalledTimes(1);
    expect(patchBrief).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing to save', async () => {
    await flushAll();

    expect(patchSite).not.toHaveBeenCalled();
  });

  it('does not send the same edit twice', async () => {
    useBoundaryStore.getState().addVertexAt({ x: 0, y: 0 });

    await flushAll();
    await vi.runAllTimersAsync();

    expect(patchSite).toHaveBeenCalledTimes(1);
  });
});
