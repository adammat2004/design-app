'use client';

import {
  House,
  Magnet,
  MousePointer2,
  Pentagon,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Undo2,
} from 'lucide-react';
import type { Unit } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';
import { ToolbarButton, ToolbarGroup } from '../ToolbarButton';

/**
 * Step 2's toolbar. Boundary and House appear but cannot be used — they are context, and
 * hiding them would make the plan look like a different drawing from the one on step 1.
 *
 * Undo, Redo, Reset and Snap act on the features store. The unit select stays on the boundary
 * store: metres or feet is a property of the whole wizard, not of one screen.
 */
export function FeaturesToolbar() {
  const unit = useBoundaryStore((state) => state.unit);
  const setUnit = useBoundaryStore((state) => state.setUnit);

  const mode = useFeaturesStore((state) => state.mode);
  const placingKind = useFeaturesStore((state) => state.placingKind);
  const snapEnabled = useFeaturesStore((state) => state.snapEnabled);
  const canUndo = useFeaturesStore((state) => state.past.length > 0);
  const canRedo = useFeaturesStore((state) => state.future.length > 0);
  const setMode = useFeaturesStore((state) => state.setMode);
  const toggleSnap = useFeaturesStore((state) => state.toggleSnap);
  const undo = useFeaturesStore((state) => state.undo);
  const redo = useFeaturesStore((state) => state.redo);
  const resetFeatures = useFeaturesStore((state) => state.resetFeatures);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolbarGroup>
        <ToolbarButton
          testId="canvas-mode-boundary"
          label="Boundary"
          hint="(locked)"
          icon={<Pentagon aria-hidden className="h-4 w-4" />}
          disabled
          title="The boundary was set on step 1. Go back to Map outdoor space to change it."
        />
        <ToolbarButton
          testId="canvas-mode-house"
          label="House"
          hint="(locked)"
          icon={<House aria-hidden className="h-4 w-4" />}
          disabled
          title="The house was placed on step 1. Go back to Map outdoor space to change it."
        />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton
          testId="canvas-mode-place"
          label="Add feature"
          icon={<Plus aria-hidden className="h-4 w-4" />}
          pressed={mode === 'place'}
          disabled={!placingKind}
          title={
            placingKind ? undefined : 'Choose a feature type from the palette on the left first.'
          }
          onClick={() => setMode('place')}
        />
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
          title="Remove every placed feature"
          onClick={resetFeatures}
        />
      </ToolbarGroup>

      <button
        type="button"
        data-testid="snap-toggle"
        aria-pressed={snapEnabled}
        onClick={toggleSnap}
        title="Snap placement to the grid"
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
