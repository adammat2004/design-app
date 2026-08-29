'use client';

import { Lightbulb } from 'lucide-react';
import { FEATURE_DEFINITIONS } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';

/** Same shape as step 1's tip, following whatever the user is in the middle of. */
export function FeaturesTipCallout() {
  const placingKind = useFeaturesStore((state) => state.placingKind);
  const drafting = useFeaturesStore((state) => state.draftPoints.length > 0);
  const selectedCount = useFeaturesStore((state) => state.selectedIds.length);
  const editing = useFeaturesStore((state) => state.editingShapeId !== null);
  const total = useFeaturesStore((state) => state.present.features.length);

  const tip = chooseTip({ placingKind, drafting, selectedCount, editing, total });

  return (
    <section
      data-testid="tip-callout"
      className="rounded-xl border border-garden-line bg-garden-sage/50 p-3"
    >
      <div className="flex items-start gap-2.5">
        <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />
        <div>
          <p className="text-[11px] leading-relaxed text-garden-muted">
            <span className="font-semibold text-garden-ink">Tip: </span>
            {tip}
          </p>
          <a
            href="/help/existing-features"
            data-testid="tip-learn-more"
            className="mt-1.5 inline-block text-[11px] font-medium text-garden-green underline underline-offset-2 hover:text-garden-forest"
          >
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
}

function chooseTip({
  placingKind,
  drafting,
  selectedCount,
  editing,
  total,
}: {
  placingKind: string | null;
  drafting: boolean;
  selectedCount: number;
  editing: boolean;
  total: number;
}): string {
  if (drafting) {
    return 'Keep clicking to trace the shape, then use Finish — or click back on the first point to close it.';
  }

  if (editing) {
    return 'Drag a corner to move it, click a side to add one, or pick a corner and press Delete.';
  }

  if (placingKind) {
    const placement =
      FEATURE_DEFINITIONS[placingKind as keyof typeof FEATURE_DEFINITIONS].placement;

    if (placement === 'point') return 'Click where it sits. You can drag it afterwards to adjust.';
    if (placement === 'rect') {
      return 'Drag out a rectangle, or click once to drop one at a default size.';
    }
    return placement === 'polygon'
      ? 'Click each corner of the area, then close the shape.'
      : 'Click along its route. The width comes from the feature type.';
  }

  if (selectedCount > 1) {
    return 'Drag any of them to move the whole group, or set Keep, Remove or Replace for all at once.';
  }

  if (selectedCount === 1) {
    return 'Use the Keep, Remove or Replace buttons on the plan, or double-click the shape to reshape it.';
  }

  if (total === 0) return 'Zoom in for precise placement. Only map what is actually there today.';

  return 'Drag across empty space to select several at once. Hold space to pan, scroll to zoom.';
}
