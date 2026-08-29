'use client';

import { createContext, useContext } from 'react';

/**
 * The id of the plan being edited.
 *
 * Context rather than a prop because the two pieces that need it most — `PlanTopBar` and
 * `PlanBottomBar` — are shared by every step, so threading it would mean touching every screen
 * to pass something none of them care about.
 */
const ProjectIdContext = createContext<string | null>(null);

export function ProjectIdProvider({ id, children }: { id: string; children: React.ReactNode }) {
  return <ProjectIdContext.Provider value={id}>{children}</ProjectIdContext.Provider>;
}

/** Throws when used outside the wizard, which is a wiring mistake rather than a state. */
export function useProjectId(): string {
  const id = useContext(ProjectIdContext);

  if (!id) {
    throw new Error('useProjectId must be used inside a /plan/[id] route.');
  }

  return id;
}

/** Builds a step URL for the current project — `planHref('map')` -> `/plan/<id>/map`. */
export function usePlanHref(): (step: string) => string {
  const id = useProjectId();

  return (step: string) => `/plan/${id}/${step}`;
}
