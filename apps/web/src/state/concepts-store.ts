'use client';

import { create } from 'zustand';
import { RevisionConflictError, ValidationError, generateConcepts } from '@/lib/plan-api';
import type { ConceptsSection, GeneratedConcept } from '@garden-studio/schema';
import { advanceRevision, projectRevision, setProjectRevision } from './revision';

/**
 * Step 4's state: the generated concepts, which one is being looked at, and which one the user
 * has committed to.
 *
 * A third store rather than more fields on the other three, for the reason step 2 gave for
 * splitting from step 1: the undoable thing here is the set of concepts, and this screen's
 * Undo must not rewind the garden the user mapped.
 *
 * Nothing on this screen edits geometry, so Undo/Redo/Reset walk **generation history**: the
 * sets produced by "Generate 3 new concepts" and "Regenerate selected". Reset goes back to the
 * first set produced for this brief.
 *
 * Generation itself runs on the server, against the stored plan. The store therefore sends no
 * garden with the request — which is also what stops a concept being generated against a stale
 * copy of one.
 */

/** Deep enough for a session of rerolling without unbounded growth. Matches features-store. */
const HISTORY_LIMIT = 50;

export const CONCEPTS_PER_SET = 3;

export interface ConceptsDraft {
  concepts: GeneratedConcept[];
  selectedId: string | null;
  /** Advanced on every roll, so a regenerate cannot reproduce what is already on screen. */
  seed: number;
}

/** What the toolbar's Plan View dropdown offers. Only `plan` is built. */
export type ConceptView = 'plan' | 'threeD' | 'isometric';

function initialDraft(): ConceptsDraft {
  return { concepts: [], selectedId: null, seed: 1 };
}

interface ConceptsState {
  past: ConceptsDraft[];
  present: ConceptsDraft;
  future: ConceptsDraft[];

  /*
   * Ephemeral, outside history — the same line features-store draws around `mode` and
   * `skipped`. Choosing a concept is a commitment rather than a generation, so an Undo that
   * rewound it would conflate "show me the previous ideas" with "I take it back".
   *
   * Held as a bare id and never auto-cleared. Whether the choice is *live* — whether the
   * concept it names is still in the current set — is derived by `chosenConcept` below, the
   * same discipline `selectZones` follows on step 1. Clearing it on every set change instead
   * looked equivalent and was not: an Undo that cleared the choice left Redo with nothing to
   * put back.
   */
  chosenConceptId: string | null;
  /** 'all' while the whole set regenerates, a concept id while one does, else null. */
  generating: 'all' | string | null;
  /**
   * Why the last generation failed, or null.
   *
   * New state, because a mock could neither fail nor take long. A 422 here means the plan has a
   * spatial problem the generator will not design around, which is a thing the user can fix.
   */
  generateError: string | null;
  compareOpen: boolean;
  compareIds: string[];
  view: ConceptView;
  lastSavedAt: number;

  /**
   * Return the promise rather than swallowing it. Callers in the UI ignore it — the screen reads
   * `generating` — but a test that could not await the request would have to poll for it.
   */
  generateAll: () => Promise<void>;
  regenerateSelected: () => Promise<void>;
  select: (id: string) => void;
  choose: (id: string) => void;
  toggleCompare: (id: string) => void;
  setCompareOpen: (open: boolean) => void;
  setView: (view: ConceptView) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

/**
 * Handle on the request in flight. Replaces the mock's timer handle: a second click has to cancel
 * the first rather than let two generations race to land.
 */
let inFlight: AbortController | null = null;

export const useConceptsStore = create<ConceptsState>((set, get) => {
  /** Pushes the current set onto the undo stack and replaces it with the new one. */
  function commit(next: ConceptsDraft) {
    set((state) => ({
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: next,
      // Branching off an undone state discards the abandoned future.
      future: [],
      lastSavedAt: Date.now(),
    }));
  }

  /**
   * Runs a generation against the server.
   *
   * `generating` is set and cleared exactly as the mock did, which is the payoff for having built
   * the loading states against a fake delay: nothing downstream of this function changed when the
   * 450 ms timer became a real multi-second request.
   */
  async function roll(
    scope: 'all' | string,
    input: { mode: 'all' } | { mode: 'one'; index: number },
  ) {
    if (!projectRevision()) return;

    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    set({ generating: scope, generateError: null });

    try {
      /*
       * Flush first. Generation is a compare-and-swap on `revision` and the server reads the
       * stored plan, so an autosave still inside the 800 ms window would 409 the generate — and
       * this screen fires one on arrival, which is inside that window after leaving the brief.
       *
       * Loaded here rather than imported: `project-sync` already imports this store, and a
       * static cycle is how the two used to each keep their own idea of the revision.
       */
      const { flushAll } = await import('./project-sync');
      await flushAll();
      if (inFlight !== controller) return;

      const { project, concepts } = await requestConcepts(input, controller.signal);

      /*
       * A newer roll superseded this one while it was in flight, so this result is stale — drop
       * it. Aborting the request is not enough on its own: the response may already have arrived
       * and been parsed, and committing it would put the older garden on top of the newer one.
       */
      if (inFlight !== controller) return;

      advanceRevision(project.revision);

      commit({
        concepts,
        selectedId: project.document.concepts.selectedId,
        seed: project.document.concepts.seed,
      });
    } catch (error) {
      // A superseded request is not a failure — the newer one owns the outcome.
      if (controller.signal.aborted) return;

      set({ generateError: describeGenerateError(error) });
    } finally {
      if (inFlight === controller) {
        inFlight = null;
        set({ generating: null });
      }
    }
  }

  return {
    past: [],
    present: initialDraft(),
    future: [],

    chosenConceptId: null,
    generating: null,
    generateError: null,
    compareOpen: false,
    compareIds: [],
    view: 'plan',
    lastSavedAt: Date.now(),

    generateAll: () => roll('all', { mode: 'all' }),

    regenerateSelected: () => {
      const { present } = get();
      const index = present.concepts.findIndex((concept) => concept.id === present.selectedId);
      if (index < 0) return Promise.resolve();

      return roll(present.concepts[index]!.id, { mode: 'one', index });
    },

    select: (id) => {
      if (get().present.selectedId === id) return;
      // Selection is not a generation, so it does not enter history — Undo would otherwise
      // mean "look at the previous card" as often as "bring back the previous ideas".
      set((state) => ({ present: { ...state.present, selectedId: id } }));
    },

    choose: (id) => set({ chosenConceptId: id, lastSavedAt: Date.now() }),

    toggleCompare: (id) =>
      set((state) => ({
        compareIds: state.compareIds.includes(id)
          ? state.compareIds.filter((candidate) => candidate !== id)
          : [...state.compareIds, id],
      })),

    setCompareOpen: (open) =>
      set((state) => ({
        compareOpen: open,
        /*
         * Opening Compare with nothing ticked would show an empty grid, so it seeds itself
         * with the concept already on the canvas plus the next one along.
         */
        compareIds:
          open && state.compareIds.length < 2
            ? state.present.concepts
                .slice(0, Math.min(2, state.present.concepts.length))
                .map((concept) => concept.id)
            : state.compareIds,
      })),

    setView: (view) => set({ view }),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return state;

        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return state;

        return {
          past: [...state.past, state.present].slice(-HISTORY_LIMIT),
          present: next,
          future: rest,
        };
      }),

    reset: () =>
      set((state) => {
        // The oldest set in the stack is the first one generated for this brief.
        const first = state.past[0];
        if (!first) return state;

        return { past: [], present: first, future: [] };
      }),
  };
});

/* ---------------------------------------------------------------- derived reads */

export function selectedConcept(state: { present: ConceptsDraft }): GeneratedConcept | null {
  return state.present.concepts.find((concept) => concept.id === state.present.selectedId) ?? null;
}

/**
 * The concept the user committed to, **if it is still on offer**.
 *
 * Regenerating can retire the very concept that was chosen. Rather than hunt down every code
 * path that could do that and clear the id there, the liveness is decided here: a chosen id
 * that names nothing in the current set simply reads as no choice. Gate Continue on this, not
 * on `chosenConceptId`, or the wizard will advance to a plan that no longer exists.
 */
export function chosenConcept(state: {
  present: ConceptsDraft;
  chosenConceptId: string | null;
}): GeneratedConcept | null {
  return state.present.concepts.find((concept) => concept.id === state.chosenConceptId) ?? null;
}

/**
 * Posts the generate request against the current revision, retrying once if that revision lost
 * a race with another write.
 *
 * Generation is a compare-and-swap. Flushing first covers the autosave window; the retry covers
 * the leftover case where a write still landed between the flush and this POST. Adopting the
 * 409's revision — rather than hydrating — keeps the in-flight roll alive: hydrate would abort
 * it and wipe `generating`.
 */
async function requestConcepts(
  input: { mode: 'all' } | { mode: 'one'; index: number },
  signal: AbortSignal,
) {
  const target = projectRevision();
  if (!target) throw new Error('No plan is loaded.');

  try {
    return await generateConcepts(target.projectId, target.revision, input, signal);
  } catch (error) {
    if (!(error instanceof RevisionConflictError) || signal.aborted) throw error;

    advanceRevision(error.current.revision);
    const retry = projectRevision();
    if (!retry) throw error;

    return generateConcepts(retry.projectId, retry.revision, input, signal);
  }
}

/** A 422 names what is wrong with the plan; anything else is a plain failure. */
function describeGenerateError(error: unknown): string {
  if (error instanceof ValidationError) {
    const [first] = error.violations;

    return first
      ? `${first.message} Fix that and generate again.`
      : 'The plan has a problem the generator cannot design around.';
  }

  return error instanceof Error ? error.message : 'Could not generate concepts.';
}

export function resetConceptsStoreForTests(): void {
  inFlight?.abort();
  inFlight = null;
  setProjectRevision(null);

  useConceptsStore.setState({
    past: [],
    present: initialDraft(),
    future: [],
    chosenConceptId: null,
    generating: null,
    generateError: null,
    compareOpen: false,
    compareIds: [],
    view: 'plan',
    lastSavedAt: Date.now(),
  });
}

/**
 * Loads the stored concepts.
 *
 * `seed` comes back with them: it is what makes a regenerate produce something new rather than
 * re-rolling what is already on screen, so a reload that reset it to 1 would hand the user the
 * same three concepts again. `chosenConceptId` is restored too — it sits outside the history
 * stack but it is the commitment step 5 reads.
 */
export function hydrateConceptsStore(section: ConceptsSection, savedAt: number): void {
  inFlight?.abort();
  inFlight = null;

  useConceptsStore.setState({
    past: [],
    future: [],
    present: {
      concepts: section.concepts,
      selectedId: section.selectedId,
      seed: section.seed,
    },
    chosenConceptId: section.chosenConceptId,
    generating: null,
    generateError: null,
    compareOpen: false,
    compareIds: [],
    view: 'plan',
    lastSavedAt: savedAt,
  });
}
