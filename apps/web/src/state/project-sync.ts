'use client';

import type { PlanProject, SectionPatchResult, ValidationViolation } from '@garden-studio/schema';
import { create } from 'zustand';
import {
  RevisionConflictError,
  patchBrief,
  patchConceptSelection,
  patchFeatures,
  patchLayout,
  patchSite,
} from '@/lib/plan-api';
import { useBoundaryStore } from './boundary-store';
import { useBriefStore } from './brief-store';
import { useConceptsStore } from './concepts-store';
import { useFeaturesStore } from './features-store';
import { hydratePlanStores } from './hydrate';
import { usePlanEditorStore } from './plan-editor-store';
import { advanceRevision, projectRevision, setProjectRevision } from './revision';

/**
 * Autosave.
 *
 * One debounced writer per document section, each subscribed to the store that owns it. Sections
 * rather than one whole-document PUT because the wizard has one save clock per screen: a brief
 * edit must not ship whatever the layout store happens to be holding, including a state the user
 * has just undone.
 *
 * The trap worth naming: **the persisted slice of a store is not just `present`**.
 * `features-store.skipped` and `concepts-store.chosenConceptId` sit outside the history stack
 * but are real user intent, so the subscriptions below have to watch them too.
 */

const DEBOUNCE_MS = 800;

type Section = 'site' | 'features' | 'brief' | 'layout' | 'conceptSelection';

interface SyncState {
  /**
   * The plan currently loaded into the stores, or null before one is.
   *
   * Lives here rather than as React state in the hydrator so the wizard can gate on it without
   * calling `setState` from inside an effect, which cascades renders.
   */
  hydratedProjectId: string | null;
  /** Sections with an unsaved edit or a request in flight. */
  pending: Section[];
  /** Epoch millis of the server's `updated_at` from the last successful write. */
  savedAt: number;
  error: string | null;
  /** What is currently spatially wrong with the plan, per the last geometry write. */
  violations: ValidationViolation[];
}

export const useSyncStore = create<SyncState>(() => ({
  hydratedProjectId: null,
  pending: [],
  savedAt: 0,
  error: null,
  violations: [],
}));

const timers = new Map<Section, ReturnType<typeof setTimeout>>();
/** Chained per section, so a second edit queues behind the first rather than racing it. */
const inFlight = new Map<Section, Promise<void>>();
const dirty = new Set<Section>();

/**
 * Set while a load is writing into the stores.
 *
 * Loading looks exactly like editing from a subscription's point of view, so without this a
 * conflict adoption would immediately schedule a write of all five sections — sending the
 * server's own document straight back to it, and overwriting whatever the other tab did next.
 */
let hydrating = false;

/** Reads the current value of each section straight off the store that owns it. */
const writers: Record<Section, (id: string, at: number) => Promise<SectionPatchResult>> = {
  site: (id, at) => patchSite(id, at, useBoundaryStore.getState().present),

  features: (id, at) => {
    const state = useFeaturesStore.getState();
    return patchFeatures(id, at, { features: state.present.features, skipped: state.skipped });
  },

  brief: (id, at) => patchBrief(id, at, useBriefStore.getState().present),

  layout: (id, at) => {
    const state = usePlanEditorStore.getState();
    return patchLayout(id, at, {
      elements: state.present.elements,
      seededFrom: state.seededFrom,
      pristine: state.pristine,
    });
  },

  conceptSelection: (id, at) => {
    const state = useConceptsStore.getState();
    return patchConceptSelection(id, at, state.present.selectedId, state.chosenConceptId);
  },
};

function markPending(section: Section, pending: boolean) {
  useSyncStore.setState((state) => {
    const rest = state.pending.filter((entry) => entry !== section);
    return { pending: pending ? [...rest, section] : rest };
  });
}

async function send(section: Section): Promise<void> {
  const target = projectRevision();
  if (!target || !dirty.has(section)) {
    markPending(section, false);
    return;
  }

  try {
    const result = await writers[section](target.projectId, target.revision);

    advanceRevision(result.project.revision);
    dirty.delete(section);

    useSyncStore.setState({
      savedAt: new Date(result.project.updatedAt).getTime(),
      error: null,
      /*
       * Only the geometry sections have anything to say about violations. A brief or selection
       * write returns an empty list, and letting that through would wipe a boundary problem the
       * user has not fixed yet.
       */
      ...(section === 'brief' || section === 'conceptSelection'
        ? {}
        : { violations: result.violations }),
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      /*
       * Another tab won. Adopt the server's version wholesale rather than attempting a merge:
       * there is no way to know which of the two the user meant, and quietly keeping ours would
       * overwrite work they can still see in the other tab.
       */
      advanceRevision(error.current.revision);
      dirty.clear();

      hydrating = true;
      try {
        hydratePlanStores(error.current);
      } finally {
        hydrating = false;
      }

      useSyncStore.setState({
        savedAt: new Date(error.current.updatedAt).getTime(),
        error: 'This plan was edited somewhere else, so that version has been loaded.',
      });
      return;
    }

    useSyncStore.setState({
      error: error instanceof Error ? error.message : 'Could not save.',
    });
  } finally {
    markPending(section, false);
  }
}

/** Queues a send behind whatever is already going out for that section. */
function enqueue(section: Section): Promise<void> {
  const next = (inFlight.get(section) ?? Promise.resolve()).then(() => send(section));

  inFlight.set(
    section,
    next.finally(() => {
      if (inFlight.get(section) === next) inFlight.delete(section);
    }),
  );

  return next;
}

function schedule(section: Section) {
  if (!projectRevision() || hydrating) return;

  dirty.add(section);
  markPending(section, true);

  const existing = timers.get(section);
  if (existing) clearTimeout(existing);

  timers.set(
    section,
    setTimeout(() => {
      timers.delete(section);
      void enqueue(section);
    }, DEBOUNCE_MS),
  );
}

let unsubscribes: (() => void)[] = [];

/**
 * Loads a plan into the stores and starts autosaving it. Returns a teardown.
 *
 * Loading and syncing are one call on purpose: the subscriptions must not exist while the load
 * is writing, or the very act of loading would schedule a write of everything it just read.
 *
 * Each subscription compares only the slice that gets persisted, so changing tools, hovering an
 * edge or dragging a marquee costs nothing.
 */
export function startProjectSync(project: PlanProject): () => void {
  setProjectRevision({ projectId: project.id, revision: project.revision });
  dirty.clear();

  hydrating = true;
  try {
    hydratePlanStores(project);
  } finally {
    hydrating = false;
  }

  useSyncStore.setState({
    hydratedProjectId: project.id,
    pending: [],
    savedAt: new Date(project.updatedAt).getTime(),
    error: null,
    violations: [],
  });

  unsubscribes = [
    useBoundaryStore.subscribe((state, previous) => {
      if (state.present !== previous.present) schedule('site');
    }),

    useFeaturesStore.subscribe((state, previous) => {
      if (state.present !== previous.present || state.skipped !== previous.skipped) {
        schedule('features');
      }
    }),

    useBriefStore.subscribe((state, previous) => {
      if (state.present !== previous.present) schedule('brief');
    }),

    usePlanEditorStore.subscribe((state, previous) => {
      if (
        state.present !== previous.present ||
        state.seededFrom !== previous.seededFrom ||
        state.pristine !== previous.pristine
      ) {
        schedule('layout');
      }
    }),

    useConceptsStore.subscribe((state, previous) => {
      if (
        state.present.selectedId !== previous.present.selectedId ||
        state.chosenConceptId !== previous.chosenConceptId
      ) {
        schedule('conceptSelection');
      }
    }),
  ];

  return () => {
    for (const off of unsubscribes) off();
    unsubscribes = [];
    setProjectRevision(null);
    useSyncStore.setState({ hydratedProjectId: null });
  };
}

/**
 * Sends everything outstanding now and waits for it.
 *
 * Called before navigating on Continue, which is load-bearing once generation is server-side:
 * arriving at step 4 before the brief has landed would generate against a stale document.
 */
export async function flushAll(): Promise<void> {
  for (const [section, timer] of timers) {
    clearTimeout(timer);
    timers.delete(section);
  }

  await Promise.all([...dirty].map((section) => enqueue(section)));
}

/** True while anything is unsaved or in flight — what the bottom bar shows as "Saving…". */
export function selectSaving(state: SyncState): boolean {
  return state.pending.length > 0;
}
