'use client';

import { CirclePlus, MousePointer2, PenLine, Trash2 } from 'lucide-react';
import { useBoundaryStore, type BoundaryTool } from '@/state/boundary-store';

const TOOLS: { tool: BoundaryTool; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    tool: 'draw',
    label: 'Draw',
    icon: <PenLine aria-hidden className="h-4 w-4" />,
    hint: 'Click on the canvas to add the next corner.',
  },
  {
    tool: 'move',
    label: 'Select',
    icon: <MousePointer2 aria-hidden className="h-4 w-4" />,
    hint: 'Click a point to adjust its position, then drag or use the arrow keys.',
  },
  {
    tool: 'add-point',
    label: 'Add point',
    icon: <CirclePlus aria-hidden className="h-4 w-4" />,
    hint: 'Click on a side to add a corner part way along it.',
  },
  {
    tool: 'delete',
    label: 'Delete',
    icon: <Trash2 aria-hidden className="h-4 w-4" />,
    hint: 'Click a point to remove it and join its neighbours.',
  },
];

export function BoundaryToolsPanel() {
  const boundaryTool = useBoundaryStore((state) => state.boundaryTool);
  const closed = useBoundaryStore((state) => state.present.closed);
  const setBoundaryTool = useBoundaryStore((state) => state.setBoundaryTool);

  const hint = TOOLS.find((item) => item.tool === boundaryTool)?.hint ?? '';

  return (
    <section className="space-y-3 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">Boundary tools</h2>

      <div className="grid grid-cols-4 gap-2">
        {TOOLS.map((item) => (
          <button
            key={item.tool}
            type="button"
            data-testid={`boundary-tool-${item.tool}`}
            aria-pressed={boundaryTool === item.tool}
            // There is nothing left to draw once the outline is closed.
            disabled={item.tool === 'draw' && closed}
            onClick={() => setBoundaryTool(item.tool)}
            className={[
              'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              boundaryTool === item.tool
                ? 'border-garden-green bg-garden-sage text-garden-forest'
                : 'border-garden-line bg-white text-garden-muted enabled:hover:border-garden-green enabled:hover:text-garden-forest',
            ].join(' ')}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <p data-testid="boundary-tool-hint" className="text-[11px] text-garden-muted">
        {hint}
      </p>
    </section>
  );
}
