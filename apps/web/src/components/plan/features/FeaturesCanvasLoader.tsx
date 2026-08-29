'use client';

import dynamic from 'next/dynamic';

/**
 * Konva's Node build requires the native `canvas` package, which breaks `next build` during
 * SSR. Same guard as the boundary canvas — keep it client-only.
 */
export const FeaturesCanvasLoader = dynamic(
  () => import('./FeaturesCanvas').then((module) => module.FeaturesCanvas),
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
