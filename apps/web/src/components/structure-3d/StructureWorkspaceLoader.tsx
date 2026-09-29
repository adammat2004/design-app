'use client';

import dynamic from 'next/dynamic';

/**
 * The 3D editor, loaded only when somebody opens it.
 *
 * Client-only for the reason every canvas here is — three.js needs a browser — and code-split so the
 * plan editor does not download three.js, React Three Fiber and drei until "Edit in 3D" is pressed.
 */
export const StructureWorkspaceLoader = dynamic(
  () => import('./StructureWorkspace').then((module) => module.StructureWorkspace),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        data-testid="structure-workspace-loading"
        className="flex min-h-[420px] flex-1 animate-pulse items-center justify-center bg-slate-100 text-xs font-medium text-garden-muted"
      >
        Loading 3D view…
      </div>
    ),
  },
);
