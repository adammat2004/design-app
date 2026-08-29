'use client';

import { useState } from 'react';
import {
  Grid3x3,
  Hand,
  Info,
  Magnet,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Undo2,
} from 'lucide-react';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { ADDABLE_CATEGORIES } from '@/lib/element-groups';
import { usePlanEditorStore, type PlanEditorMode } from '@/state/plan-editor-store';
import { ToolbarButton, ToolbarGroup } from '../ToolbarButton';
import { EditorIcon } from './EditorIcon';

/**
 * The bar above the plan.
 *
 * Three view tabs, of which one works. 3D and Visualise are rendered rather than omitted because
 * they are on the roadmap and their absence would be the more confusing choice — the same
 * `available` flag pattern step 4's view select uses.
 *
 * Move is the pan tool, wired to the same `panning` state the zoom stack's hand button drives, so
 * there is one pan in the app rather than two that can disagree about whether the view is being
 * dragged.
 */

const VIEWS: { id: string; label: string; available: boolean }[] = [
  { id: 'plan', label: 'Plan', available: true },
  { id: '3d', label: '3D', available: false },
  { id: 'visualise', label: 'Visualise', available: false },
];

const TOOLS: { id: PlanEditorMode; label: string; icon: React.ReactNode; title: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: <MousePointer2 aria-hidden className="h-4 w-4" />,
    title: 'Click to select, drag to move',
  },
  {
    id: 'pan',
    label: 'Move',
    icon: <Hand aria-hidden className="h-4 w-4" />,
    title: 'Drag to move the view',
  },
  {
    id: 'measure',
    label: 'Measure',
    icon: <Ruler aria-hidden className="h-4 w-4" />,
    title: 'Click two points to measure between them',
  },
];

export function EditorToolbar() {
  const mode = usePlanEditorStore((state) => state.mode);
  const setMode = usePlanEditorStore((state) => state.setMode);
  const snapEnabled = usePlanEditorStore((state) => state.snapEnabled);
  const toggleSnap = usePlanEditorStore((state) => state.toggleSnap);
  const gridVisible = usePlanEditorStore((state) => state.gridVisible);
  const toggleGrid = usePlanEditorStore((state) => state.toggleGrid);
  const canUndo = usePlanEditorStore((state) => state.past.length > 0);
  const canRedo = usePlanEditorStore((state) => state.future.length > 0);
  const hasPristine = usePlanEditorStore((state) => state.pristine !== null);
  const undo = usePlanEditorStore((state) => state.undo);
  const redo = usePlanEditorStore((state) => state.redo);
  const resetToConcept = usePlanEditorStore((state) => state.resetToConcept);
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);

  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolbarGroup>
        {VIEWS.map((view) => (
          <ToolbarButton
            key={view.id}
            testId={`view-${view.id}`}
            label={view.label}
            icon={null}
            pressed={view.available}
            disabled={!view.available}
            title={view.available ? 'Plan view' : `${view.label} view is coming soon`}
          />
        ))}
      </ToolbarGroup>

      <ToolbarGroup>
        {TOOLS.map((tool) => (
          <ToolbarButton
            key={tool.id}
            testId={`tool-${tool.id}`}
            label={tool.label}
            icon={tool.icon}
            pressed={mode === tool.id}
            title={tool.title}
            onClick={() => setMode(tool.id)}
          />
        ))}
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton
          testId="editor-undo"
          label="Undo"
          icon={<Undo2 aria-hidden className="h-4 w-4" />}
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolbarButton
          testId="editor-redo"
          label="Redo"
          icon={<Redo2 aria-hidden className="h-4 w-4" />}
          disabled={!canRedo}
          onClick={redo}
        />
        <ToolbarButton
          testId="editor-reset"
          label="Reset"
          icon={<RotateCcw aria-hidden className="h-4 w-4" />}
          disabled={!hasPristine}
          title="Back to the concept as generated, discarding your edits"
          onClick={resetToConcept}
        />
      </ToolbarGroup>

      {/* Add feature — the palette's twin, for when the left column is scrolled away. */}
      <div className="relative">
        <button
          type="button"
          data-testid="add-feature"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((open) => !open)}
          className={[
            'flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium shadow-sm transition-colors',
            'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
            placingCategory
              ? 'border-garden-forest bg-garden-forest text-white'
              : 'border-garden-line bg-white text-garden-ink hover:border-garden-green',
          ].join(' ')}
        >
          <Plus aria-hidden className="h-4 w-4" />
          Add feature
        </button>

        {addOpen ? (
          <ul
            data-testid="add-feature-menu"
            className="absolute top-full left-0 z-10 mt-1 w-48 space-y-0.5 rounded-xl border border-garden-line bg-white p-1 shadow-lg"
          >
            {ADDABLE_CATEGORIES.map((category) => (
              <li key={category}>
                <button
                  type="button"
                  data-testid={`add-${category}`}
                  onClick={() => {
                    setPlacing(category);
                    setAddOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
                >
                  <EditorIcon category={category} className="h-3.5 w-3.5 text-garden-muted" />
                  {CATEGORY_COLOURS[category].label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <button
        type="button"
        data-testid="editor-snap"
        aria-pressed={snapEnabled}
        title="Snap placement to the grid and to alignment guides"
        onClick={toggleSnap}
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

      <button
        type="button"
        data-testid="editor-grid"
        aria-pressed={gridVisible}
        title="Show the measuring grid"
        onClick={toggleGrid}
        className={[
          'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium shadow-sm transition-colors',
          'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
          gridVisible
            ? 'border-garden-forest bg-garden-forest text-white'
            : 'border-garden-line bg-white text-garden-muted hover:border-garden-green',
        ].join(' ')}
      >
        <Grid3x3 aria-hidden className="h-4 w-4" />
        Grid
        <span
          className={[
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            gridVisible ? 'bg-white/20 text-white' : 'bg-garden-line text-garden-muted',
          ].join(' ')}
        >
          {gridVisible ? 'ON' : 'OFF'}
        </span>
      </button>

      <div className="relative ml-auto">
        <button
          type="button"
          data-testid="editor-help"
          aria-label="How this screen works"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
          className="rounded-full border border-garden-line bg-white p-2 text-garden-muted shadow-sm hover:bg-garden-sage hover:text-garden-forest focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
        >
          <Info aria-hidden className="h-4 w-4" />
        </button>

        {helpOpen ? (
          <div
            data-testid="editor-help-popover"
            className="absolute top-full right-0 z-10 mt-1 w-64 rounded-xl border border-garden-line bg-white p-3 shadow-lg"
          >
            <p className="text-[11px] leading-relaxed text-garden-muted">
              Drag anything on the plan to move it, or select it to resize and change what it is
              made of. Nothing can overlap the house or cross the boundary — an edit that would is
              refused rather than nudged.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-garden-muted">
              The ground layer under each zone keeps the garden fully covered, so its shape is
              fixed. Its material is not.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
