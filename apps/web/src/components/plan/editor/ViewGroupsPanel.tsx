'use client';

import { useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { VIEW_GROUP_LABELS, VIEW_GROUP_ORDER, viewGroupOf, type ViewGroup } from '@/lib/view-groups';
import { usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * Whole groups on and off — "hide the furniture so I can see the paving".
 *
 * Only the groups the plan actually has are listed: a Water row on a garden with no water is a
 * switch that does nothing, which is the fault this codebase keeps catching. Each row says how many
 * things it hides, so switching one off is never a surprise about how much went.
 */
export function ViewGroupsPanel() {
  const elements = usePlanEditorStore((state) => state.present.elements);
  const hiddenGroups = usePlanEditorStore((state) => state.hiddenGroups);
  const toggleGroup = usePlanEditorStore((state) => state.toggleGroup);

  const counts = useMemo(() => {
    const tally = new Map<ViewGroup, number>();
    for (const element of elements) {
      const group = viewGroupOf(element);
      tally.set(group, (tally.get(group) ?? 0) + 1);
    }
    return tally;
  }, [elements]);

  const present = VIEW_GROUP_ORDER.filter((group) => (counts.get(group) ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <section data-testid="view-groups">
      <h2 className="text-xs font-semibold text-garden-ink">Show on plan</h2>
      <ul className="mt-2 space-y-0.5">
        {present.map((group) => {
          const shown = !hiddenGroups.includes(group);
          const label = VIEW_GROUP_LABELS[group];
          return (
            <li key={group}>
              <button
                type="button"
                data-testid={`view-group-${group}`}
                aria-pressed={shown}
                aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                onClick={() => toggleGroup(group)}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left',
                  'hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
                  shown ? '' : 'opacity-50',
                ].join(' ')}
              >
                {shown ? (
                  <Eye aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
                ) : (
                  <EyeOff aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-garden-ink">{label}</span>
                <span className="shrink-0 text-[10px] text-garden-muted tabular-nums">
                  {counts.get(group)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
