'use client';

import dynamic from 'next/dynamic';

/**
 * Konva's Node build requires the native `canvas` package, which breaks `next build` during
 * SSR. Keep the canvas client-only.
 */
export const BoundaryCanvasLoader = dynamic(
  () => import('./BoundaryCanvas').then((mod) => mod.BoundaryCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="h-full min-h-[420px] w-full animate-pulse rounded-xl border border-garden-line bg-white"
      />
    ),
  },
);
