'use client';

import dynamic from 'next/dynamic';

/**
 * The whole-garden preview, loaded only when somebody opens it — client-only because three.js needs
 * a browser, and code-split so neither the plan editor nor the review screen downloads three.js,
 * React Three Fiber, drei or the scene builder's geometry until "View in 3D" is pressed.
 */
export const GardenPreviewLoader = dynamic(
  () => import('./GardenPreview').then((module) => module.GardenPreview),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        data-testid="garden-preview-loading"
        className="fixed inset-0 z-50 flex animate-pulse items-center justify-center bg-slate-100 text-xs font-medium text-garden-muted"
      >
        Loading your garden in 3D…
      </div>
    ),
  },
);
