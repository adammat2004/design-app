'use client';

import { useMemo } from 'react';
import type { EdgeRuleContext, GardenBrief } from '@garden-studio/schema';
import { useBriefStore } from '@/state/brief-store';

/**
 * The brief's say in what automatic edging lays, for every surface that draws a plan.
 *
 * **One source for all of them, and that is the point.** The editor, Visualise, the concept cards,
 * the PNG export and the schedule each build their own scene, and a scene built without the brief
 * resolves a formal garden's borders as if no style had been chosen. The export disagreeing with
 * the screen is the symptom two separate bugs in this codebase have already shared; routing every
 * caller through here is what stops edging becoming the third.
 */
export function edgeRulesOf(brief: Pick<GardenBrief, 'style' | 'budget' | 'maintenance'>): EdgeRuleContext {
  return {
    style: brief.style ?? null,
    budget: brief.budget ?? null,
    maintenance: brief.maintenance ?? null,
  };
}

/** The same, read live — for a render that happens outside React. */
export function edgeRulesNow(): EdgeRuleContext {
  return edgeRulesOf(useBriefStore.getState().present);
}

/** The same, as a hook. Stable while none of the three fields changes, so a scene memo holds. */
export function useEdgeRules(): EdgeRuleContext {
  const style = useBriefStore((state) => state.present.style);
  const budget = useBriefStore((state) => state.present.budget);
  const maintenance = useBriefStore((state) => state.present.maintenance);
  return useMemo(() => edgeRulesOf({ style, budget, maintenance }), [style, budget, maintenance]);
}
