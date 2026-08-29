'use client';

import { Move, Pentagon, RotateCw, SquareDashed, Trash2 } from 'lucide-react';
import { useBoundaryStore, type HouseTool } from '@/state/boundary-store';
import { OpeningsPanel } from './OpeningsPanel';

/** Shapes create the footprint; edit tools change one that already exists. */
const SHAPE_TOOLS: HouseTool[] = ['rectangle', 'custom'];

const TOOLS: { tool: HouseTool; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    tool: 'rectangle',
    label: 'Rectangle',
    icon: <SquareDashed aria-hidden className="h-4 w-4" />,
    hint: 'Drag out a rectangle on the plan to place your house.',
  },
  {
    tool: 'custom',
    label: 'Custom shape',
    icon: <Pentagon aria-hidden className="h-4 w-4" />,
    hint: 'Click each corner of the house, then close the outline.',
  },
  {
    tool: 'move',
    label: 'Move',
    icon: <Move aria-hidden className="h-4 w-4" />,
    hint: 'Drag the house, or nudge it with the arrow keys.',
  },
  {
    tool: 'rotate',
    label: 'Rotate',
    icon: <RotateCw aria-hidden className="h-4 w-4" />,
    hint: 'Drag the handle above the house, or type an angle on the right.',
  },
];

export function HouseToolsPanel() {
  const houseTool = useBoundaryStore((state) => state.houseTool);
  const hasHouse = useBoundaryStore((state) => state.present.house !== null);
  const setHouseTool = useBoundaryStore((state) => state.setHouseTool);
  const removeHouse = useBoundaryStore((state) => state.removeHouse);

  const hint = TOOLS.find((item) => item.tool === houseTool)?.hint ?? '';

  function renderTool(item: (typeof TOOLS)[number]) {
    // Move and Rotate need something to act on.
    const disabled = !hasHouse && (item.tool === 'move' || item.tool === 'rotate');

    return (
      <button
        key={item.tool}
        type="button"
        data-testid={`house-tool-${item.tool}`}
        aria-pressed={houseTool === item.tool}
        disabled={disabled}
        onClick={() => setHouseTool(item.tool)}
        className={[
          'flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-[11px] font-medium transition-colors',
          'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-40',
          houseTool === item.tool
            ? 'border-garden-green bg-garden-sage text-garden-forest'
            : 'border-garden-line bg-white text-garden-muted enabled:hover:border-garden-green enabled:hover:text-garden-forest',
        ].join(' ')}
      >
        {item.icon}
        {item.label}
      </button>
    );
  }

  return (
    <>
      <section className="space-y-3 border-t border-garden-line pt-4">
        <h2 className="text-xs font-semibold text-garden-ink">Add house footprint</h2>
        <p className="text-[11px] leading-relaxed text-garden-muted">
          Choose a shape, then click or drag on the map to place it.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {TOOLS.filter((item) => SHAPE_TOOLS.includes(item.tool)).map(renderTool)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-garden-ink">Edit tools</h2>

        <div className="grid grid-cols-2 gap-2">
          {TOOLS.filter((item) => !SHAPE_TOOLS.includes(item.tool)).map(renderTool)}
        </div>

        <p data-testid="house-tool-hint" className="text-[11px] text-garden-muted">
          {hint}
        </p>

        {hasHouse ? (
          <button
            type="button"
            data-testid="remove-house"
            onClick={removeHouse}
            className="flex items-center gap-1.5 text-[11px] font-medium text-garden-muted hover:text-red-700"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Remove house
          </button>
        ) : null}
      </section>

      {/* Optional refinement, attached to the house rather than given a screen of its own. */}
      <OpeningsPanel />
    </>
  );
}
