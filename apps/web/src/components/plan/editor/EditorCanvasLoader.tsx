'use client';

import dynamic from 'next/dynamic';

/**
 * Konva's Node build requires the native `canvas` package, which breaks `next build` during
 * SSR. Same guard as every other canvas in the wizard — keep it client-only.
 */
export const EditorCanvasLoader = dynamic(
  () => import('./EditorCanvas').then((module) => module.EditorCanvas),
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
