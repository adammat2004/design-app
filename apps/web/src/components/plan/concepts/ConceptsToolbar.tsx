'use client';

import { Columns2, Layers, RotateCcw, Redo2, Sparkles, Undo2 } from 'lucide-react';
import type { ConceptView } from '@/state/concepts-store';
import { useConceptsStore } from '@/state/concepts-store';
import { ToolbarButton, ToolbarGroup } from '../ToolbarButton';

/**
 * The bar above the plan.
 *
 * Nothing on this screen edits geometry, so Undo / Redo / Reset walk **generation history** —
 * the sets of ideas, not the shapes. That is the only reading of those three buttons that has
 * a meaning here, and it is the one the store implements.
 *
 * Zoom deliberately does not appear: it lives in `CanvasChrome`'s stack in the canvas's own
 * bottom-right corner, where steps 1 and 2 put it. Two zoom controls in two places across
 * three screens would be worse than one control in a slightly different place from the mockup.
 */

const VIEWS: { id: ConceptView; label: string; available: boolean }[] = [
  { id: 'plan', label: 'Plan view', available: true },
  { id: 'threeD', label: '3D preview (coming soon)', available: false },
  { id: 'isometric', label: 'Isometric (coming soon)', available: false },
];

export function ConceptsToolbar() {
  const view = useConceptsStore((state) => state.view);
  const setView = useConceptsStore((state) => state.setView);
  const compareOpen = useConceptsStore((state) => state.compareOpen);
  const setCompareOpen = useConceptsStore((state) => state.setCompareOpen);
  const generating = useConceptsStore((state) => state.generating);
  const canUndo = useConceptsStore((state) => state.past.length > 0);
  const canRedo = useConceptsStore((state) => state.future.length > 0);
  const hasHistory = useConceptsStore((state) => state.past.length > 0);
  const selectedId = useConceptsStore((state) => state.present.selectedId);
  const undo = useConceptsStore((state) => state.undo);
  const redo = useConceptsStore((state) => state.redo);
  const reset = useConceptsStore((state) => state.reset);
  const regenerateSelected = useConceptsStore((state) => state.regenerateSelected);

  const busy = generating !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolbarGroup>
        <ToolbarButton
          testId="toggle-compare"
          label="Compare"
          icon={<Columns2 aria-hidden className="h-4 w-4" />}
          pressed={compareOpen}
          title="Show two or more concepts side by side"
          onClick={() => setCompareOpen(!compareOpen)}
        />
      </ToolbarGroup>

      <label className="flex items-center gap-1.5 rounded-xl border border-garden-line bg-white p-1 pl-2.5 shadow-sm">
        <Layers aria-hidden className="h-4 w-4 text-garden-muted" />
        <span className="sr-only">Plan view mode</span>
        <select
          data-testid="view-mode"
          value={view}
          onChange={(event) => setView(event.target.value as ConceptView)}
          className="rounded-lg bg-transparent px-1 py-1.5 text-xs font-medium text-garden-ink focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
        >
          {VIEWS.map((option) => (
            <option key={option.id} value={option.id} disabled={!option.available}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <ToolbarGroup>
        <ToolbarButton
          testId="concepts-undo"
          label="Undo"
          icon={<Undo2 aria-hidden className="h-4 w-4" />}
          disabled={!canUndo || busy}
          title="Go back to the previous set of ideas"
          onClick={undo}
        />
        <ToolbarButton
          testId="concepts-redo"
          label="Redo"
          icon={<Redo2 aria-hidden className="h-4 w-4" />}
          disabled={!canRedo || busy}
          title="Return to the set you undid"
          onClick={redo}
        />
        <ToolbarButton
          testId="concepts-reset"
          label="Reset"
          icon={<RotateCcw aria-hidden className="h-4 w-4" />}
          disabled={!hasHistory || busy}
          title="Back to the first set generated for this brief"
          onClick={reset}
        />
      </ToolbarGroup>

      <button
        type="button"
        data-testid="regenerate-selected"
        disabled={busy || !selectedId}
        onClick={regenerateSelected}
        className="ml-auto flex items-center gap-2 rounded-xl border border-garden-green bg-garden-sage px-3 py-2 text-xs font-semibold text-garden-forest shadow-sm transition-colors hover:bg-garden-sage/70 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles
          aria-hidden
          className={['h-4 w-4', generating && generating !== 'all' ? 'animate-spin' : ''].join(
            ' ',
          )}
        />
        {generating && generating !== 'all' ? 'Regenerating…' : 'Regenerate selected'}
      </button>
    </div>
  );
}
