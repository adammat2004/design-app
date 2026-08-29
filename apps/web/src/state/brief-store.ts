'use client';

import { create } from 'zustand';
import {
  clampOther,
  clampPurpose,
  emptyBrief,
  toggleDesiredFeature,
  type BudgetBand,
  type DesiredFeature,
  type GardenBrief,
  type MaintenanceLevel,
  type StyleDirection,
} from '@/lib/brief';

/**
 * Step 3's state: what the user wants, ready to hand to a generator.
 *
 * A third store rather than fields on the other two, for the same reason `features-store`
 * is separate from `boundary-store` — and the dependency runs no way at all here. Nothing in
 * this file reads the boundary or the features; the one screen that needs all three subscribes
 * to each directly.
 *
 * **No past/present/future stack, deliberately.** The other two carry one because their
 * undoable unit is a drag — dozens of intermediate states, and no way to eye where it started.
 * Every answer here is a discrete named choice whose current value is displayed by the control
 * that sets it, so undo is clicking the other card. There is also nothing to hang a stack on:
 * Undo and Redo live in the canvas toolbars, and this screen has no canvas. For the two text
 * fields the browser's own Ctrl+Z is finer-grained than a store-level stack, which would fight
 * it by rewriting `value` mid-edit.
 *
 * The state field is still called `present` so panels read the same as they do on steps 1 and
 * 2, and so wrapping history round it later stays a change inside this file.
 */

interface BriefState {
  present: GardenBrief;
  lastSavedAt: number;

  setPurpose: (text: string) => void;
  toggleFeature: (id: DesiredFeature) => void;
  setFeaturesOther: (text: string) => void;
  setBudget: (band: BudgetBand) => void;
  setMaintenance: (level: MaintenanceLevel) => void;
  setStyle: (style: StyleDirection) => void;
  setStyleOther: (text: string) => void;
  resetBrief: () => void;
}

export const useBriefStore = create<BriefState>((set) => {
  /**
   * Every mutation goes through here, so no setter can forget to stamp `lastSavedAt` — and a
   * no-op edit (retyping the same character, reselecting the same card) does not pretend to
   * be a save.
   */
  function edit(mutate: (brief: GardenBrief) => GardenBrief) {
    set((state) => {
      const next = mutate(state.present);
      return next === state.present ? state : { present: next, lastSavedAt: Date.now() };
    });
  }

  return {
    present: emptyBrief(),
    lastSavedAt: Date.now(),

    setPurpose: (text) =>
      edit((brief) => {
        const purpose = clampPurpose(text);
        return purpose === brief.purpose ? brief : { ...brief, purpose };
      }),

    toggleFeature: (id) =>
      edit((brief) => {
        const desiredFeatures = toggleDesiredFeature(brief.desiredFeatures, id);

        return {
          ...brief,
          desiredFeatures,
          // Un-ticking Other throws its text away — the rule `replaceWith` follows on step 2.
          featuresOther: desiredFeatures.includes('other') ? brief.featuresOther : '',
        };
      }),

    setFeaturesOther: (text) =>
      edit((brief) => {
        const featuresOther = clampOther(text);
        return featuresOther === brief.featuresOther ? brief : { ...brief, featuresOther };
      }),

    // Budget, maintenance and style gate Continue, so there is no way to unset them once
    // chosen — only to choose differently. Nothing here can put the brief back below the bar.
    setBudget: (budget) =>
      edit((brief) => (brief.budget === budget ? brief : { ...brief, budget })),

    setMaintenance: (maintenance) =>
      edit((brief) => (brief.maintenance === maintenance ? brief : { ...brief, maintenance })),

    setStyle: (style) =>
      edit((brief) =>
        brief.style === style
          ? brief
          : { ...brief, style, styleOther: style === 'other' ? brief.styleOther : '' },
      ),

    setStyleOther: (text) =>
      edit((brief) => {
        const styleOther = clampOther(text);
        return styleOther === brief.styleOther ? brief : { ...brief, styleOther };
      }),

    resetBrief: () => set({ present: emptyBrief(), lastSavedAt: Date.now() }),
  };
});

/** The store is a module singleton, so suites must reset it between cases. */
export function resetBriefStoreForTests(): void {
  useBriefStore.setState({ present: emptyBrief(), lastSavedAt: Date.now() });
}

/** Loads the stored brief. No history stack and no ids here, so there is nothing to re-seed. */
export function hydrateBriefStore(brief: GardenBrief, savedAt: number): void {
  useBriefStore.setState({ present: brief, lastSavedAt: savedAt });
}
