'use client';

import type { PlanProject } from '@garden-studio/schema';
import { hydrateBoundaryStore } from './boundary-store';
import { hydrateBriefStore } from './brief-store';
import { hydrateConceptsStore } from './concepts-store';
import { hydrateFeaturesStore } from './features-store';
import { hydratePlanEditorStore } from './plan-editor-store';

/**
 * Loads a stored plan into all five stores.
 *
 * Ordered document-first so nothing derived is computed against a half-loaded plan: the
 * boundary and house go in before the features that are checked against them, and before the
 * concepts and layout that were generated inside them.
 *
 * Every store clears its own undo stack and ephemeral state as part of this, and re-seeds its id
 * counter. Undo therefore reads empty straight after a load, which is deliberate — see
 * `hydrateBoundaryStore`.
 */
export function hydratePlanStores(project: PlanProject): void {
  const { document } = project;
  const savedAt = new Date(project.updatedAt).getTime();

  hydrateBoundaryStore(document.site, document.unit, project.name, savedAt);
  hydrateFeaturesStore(document.features, savedAt);
  hydrateBriefStore(document.brief, savedAt);
  hydrateConceptsStore(document.concepts, savedAt);
  hydratePlanEditorStore(document.layout, savedAt);
}
