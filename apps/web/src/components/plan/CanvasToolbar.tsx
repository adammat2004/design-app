'use client';

import {
  Car,
  House,
  Magnet,
  MousePointer2,
  Pentagon,
  Redo2,
  RotateCcw,
  Ruler,
  SquareDashed,
  Undo2,
} from 'lucide-react';
import type { Unit } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { ToolbarButton, ToolbarGroup } from './ToolbarButton';

export function CanvasToolbar() {
  const mode = useBoundaryStore((state) => state.mode);
  const closed = useBoundaryStore((state) => state.present.closed);
  const unit = useBoundaryStore((state) => state.unit);
  const snapEnabled = useBoundaryStore((state) => state.snapEnabled);
  const rightAngleSnap = useBoundaryStore((state) => state.rightAngleSnap);
  const sizeAnchorVisible = useBoundaryStore((state) => state.sizeAnchorVisible);
  const canUndo = useBoundaryStore((state) => state.past.length > 0);
  const canRedo = useBoundaryStore((state) => state.future.length > 0);
  const setMode = useBoundaryStore((state) => state.setMode);
  const setBoundaryTool = useBoundaryStore((state) => state.setBoundaryTool);
  const setUnit = useBoundaryStore((state) => state.setUnit);
  const toggleSnap = useBoundaryStore((state) => state.toggleSnap);
  const toggleRightAngle = useBoundaryStore((state) => state.toggleRightAngle);
  const toggleSizeAnchor = useBoundaryStore((state) => state.toggleSizeAnchor);
  const undo = useBoundaryStore((state) => state.undo);
  const redo = useBoundaryStore((state) => state.redo);
  const resetDraft = useBoundaryStore((state) => state.resetDraft);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* What you are drawing. */}
      <ToolbarGroup>
        <ToolbarButton
          testId="canvas-mode-boundary"
          label="Boundary"
          icon={<Pentagon aria-hidden className="h-4 w-4" />}
          pressed={mode === 'boundary'}
          onClick={() => setBoundaryTool(closed ? 'move' : 'draw')}
        />
        <ToolbarButton
          testId="canvas-mode-house"
          label="House"
          icon={<House aria-hidden className="h-4 w-4" />}
          pressed={mode === 'house'}
          // Nothing to put a house inside of until the plot is enclosed.
          disabled={!closed}
          onClick={() => setMode('house')}
        />
      </ToolbarGroup>

      {/* What you are inspecting. */}
      <ToolbarGroup>
        <ToolbarButton
          testId="canvas-mode-select"
          label="Select"
          icon={<MousePointer2 aria-hidden className="h-4 w-4" />}
          pressed={mode === 'select'}
          onClick={() => setMode('select')}
        />
        <ToolbarButton
          testId="canvas-mode-measure"
          label="Measure"
          icon={<Ruler aria-hidden className="h-4 w-4" />}
          pressed={mode === 'measure'}
          onClick={() => setMode('measure')}
        />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton
          testId="canvas-tool-undo"
          label="Undo"
          icon={<Undo2 aria-hidden className="h-4 w-4" />}
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolbarButton
          testId="canvas-tool-redo"
          label="Redo"
          icon={<Redo2 aria-hidden className="h-4 w-4" />}
          disabled={!canRedo}
          onClick={redo}
        />
        <ToolbarButton
          testId="canvas-tool-reset"
          label="Reset"
          icon={<RotateCcw aria-hidden className="h-4 w-4" />}
          onClick={resetDraft}
        />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton
          testId="right-angle-toggle"
          label="Right angles"
          title="Hold each new side square to the one before it. Most plots have right angles; switch this off for an awkward one."
          icon={<SquareDashed aria-hidden className="h-4 w-4" />}
          pressed={rightAngleSnap}
          // Nothing left to draw once the outline is closed.
          disabled={closed}
          onClick={toggleRightAngle}
        />
        <ToolbarButton
          testId="size-anchor-toggle"
          label="Car for scale"
          title="Park a real 4.5 m car beside the plot to check the drawing's scale"
          icon={<Car aria-hidden className="h-4 w-4" />}
          pressed={sizeAnchorVisible}
          disabled={!closed}
          onClick={toggleSizeAnchor}
        />
      </ToolbarGroup>

      <button
        type="button"
        data-testid="snap-toggle"
        aria-pressed={snapEnabled}
        onClick={toggleSnap}
        title="Snap placement to the grid and to alignment guides"
        className={[
          'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium shadow-sm transition-colors',
          'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
          snapEnabled
            ? 'border-garden-forest bg-garden-forest text-white'
            : 'border-garden-line bg-white text-garden-muted hover:border-garden-green',
        ].join(' ')}
      >
        <Magnet aria-hidden className="h-4 w-4" />
        Snap
        <span
          className={[
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            snapEnabled ? 'bg-white/20 text-white' : 'bg-garden-line text-garden-muted',
          ].join(' ')}
        >
          {snapEnabled ? 'ON' : 'OFF'}
        </span>
      </button>

      <label className="ml-auto flex items-center gap-2 rounded-xl border border-garden-line bg-white px-3 py-2 text-xs font-medium shadow-sm">
        <span className="sr-only">Units</span>
        <select
          data-testid="unit-select"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
          className="bg-transparent text-sm text-garden-ink focus-visible:outline-none"
        >
          <option value="m">m</option>
          <option value="ft">ft</option>
        </select>
      </label>
    </div>
  );
}
