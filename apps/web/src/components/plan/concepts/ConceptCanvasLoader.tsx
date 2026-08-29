'use client';

import dynamic from 'next/dynamic';

/**
 * Konva's Node build requires the native `canvas` package, which breaks `next build` during
 * SSR. Same guard as the boundary and features canvases — keep it client-only.
 */
export const ConceptCanvasLoader = dynamic(
  () => import('./ConceptCanvas').then((module) => module.ConceptCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="h-full min-h-[240px] w-full animate-pulse rounded-xl border border-garden-line bg-white"
      />
    ),
  },
);
