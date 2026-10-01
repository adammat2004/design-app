'use client';

import { Rotate3d } from 'lucide-react';
import { useGardenPreviewStore } from '@/state/garden-preview-store';
import { ToolbarButton } from '../plan/ToolbarButton';

/** Opens the whole-garden preview. `primary` is the review screen's larger button. */
export function ViewInThreeDButton({ variant = 'toolbar', disabled = false }: { variant?: 'toolbar' | 'primary'; disabled?: boolean }) {
  const open = useGardenPreviewStore((state) => state.openPreview);
  if (variant === 'primary') {
    return (
      <button
        type="button"
        data-testid="view-in-3d"
        disabled={disabled}
        onClick={open}
        className="flex items-center gap-2 rounded-xl border border-garden-line bg-white px-4 py-2.5 text-sm font-medium text-garden-ink shadow-sm transition-colors hover:border-garden-green hover:bg-garden-sage/50 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:opacity-60"
      >
        <Rotate3d aria-hidden className="h-4 w-4" />
        View in 3D
      </button>
    );
  }
  return (
    <ToolbarButton
      testId="view-in-3d"
      label="View in 3D"
      icon={<Rotate3d aria-hidden className="h-4 w-4" />}
      disabled={disabled}
      title="Look round the whole garden in 3D"
      onClick={open}
    />
  );
}
