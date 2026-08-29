'use client';

import type { PlanProject } from '@garden-studio/schema';
import { Sprout } from 'lucide-react';
import { useEffect } from 'react';
import { startProjectSync, useSyncStore } from '@/state/project-sync';
import { ProjectIdProvider } from './ProjectContext';

/**
 * Loads a stored plan into the stores, then renders the wizard.
 *
 * The gate matters. The stores are module singletons, so they cannot be filled in on the server:
 * one module instance is shared by every request, which would both leak one visitor's plan into
 * another's HTML and — as the first attempt at this proved — race the screens' own render, so
 * step 1 server-rendered "Close the property boundary" over a boundary that was closed weeks ago.
 *
 * Rendering a placeholder until the client has loaded the plan is the honest version: the screens
 * only ever see a plan that is fully there, and nothing is ever briefly wrong on screen. It costs
 * little, because every canvas in this app is already `dynamic(..., { ssr: false })` — the plan
 * was never really server-rendered.
 */
export function ProjectHydrator({
  project,
  children,
}: {
  project: PlanProject;
  children: React.ReactNode;
}) {
  // Read from the sync store rather than local state: gating on React state would mean setting it
  // inside the effect below, which cascades renders.
  const loaded = useSyncStore((state) => state.hydratedProjectId === project.id);

  useEffect(() => startProjectSync(project), [project]);

  if (!loaded) return <LoadingPlan name={project.name} />;

  return <ProjectIdProvider id={project.id}>{children}</ProjectIdProvider>;
}

function LoadingPlan({ name }: { name: string }) {
  return (
    <div
      data-testid="loading-plan"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
        <Sprout aria-hidden className="h-6 w-6 text-garden-green" />
      </span>
      <p className="text-sm font-semibold text-garden-forest">{name}</p>
      <p className="text-xs text-garden-muted">Loading your plan…</p>
    </div>
  );
}
