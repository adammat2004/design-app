'use client';

import { useState } from 'react';
import {
  Grid3x3,
  Hand,
  LayoutGrid,
  Info,
  Magnet,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Tag,
  Undo2,
} from 'lucide-react';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { ADDABLE_CATEGORIES } from '@/lib/element-groups';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { usePlanEditorStore, type PlanEditorMode } from '@/state/plan-editor-store';
import { DownloadPlanButton } from '../DownloadPlanButton';
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

/**
 * The two views this editor has.
 *
 * **3D is gone rather than disabled.** It sat here greyed out on the argument that omitting it
 * would be more confusing than showing it — which was reasonable while both extra tabs were
 * roadmap. It is not any more: Visualise now does something, and a permanently dead tab beside a
 * live one reads as a broken feature rather than a planned one. React Three Fiber stays installed;
 * when there is a 3D view worth having, the tab comes back.
 */
const VIEWS: { id: 'plan' | 'visualise'; label: string }[] = [
  { id: 'plan', label: '2D Plan' },
  { id: 'visualise', label: 'Visualise' },
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

export function EditorToolbar({
  view,
  setView,
}: {
  view: 'plan' | 'visualise';
  setView: (view: 'plan' | 'visualise') => void;
}) {
  const mode = usePlanEditorStore((state) => state.mode);
  const setMode = usePlanEditorStore((state) => state.setMode);
  const snapEnabled = usePlanEditorStore((state) => state.snapEnabled);
  const toggleSnap = usePlanEditorStore((state) => state.toggleSnap);
  const gridVisible = usePlanEditorStore((state) => state.gridVisible);
  const labelsVisible = usePlanEditorStore((state) => state.labelsVisible);
  const toggleLabels = usePlanEditorStore((state) => state.toggleLabels);
  const toggleGrid = usePlanEditorStore((state) => state.toggleGrid);
  const zonesVisible = usePlanEditorStore((state) => state.zonesVisible);
  const toggleZones = usePlanEditorStore((state) => state.toggleZones);
  const dimensionsVisible = usePlanEditorStore((state) => state.dimensionsVisible);
  const toggleDimensions = usePlanEditorStore((state) => state.toggleDimensions);
  const canUndo = usePlanEditorStore((state) => state.past.length > 0);
  const canRedo = usePlanEditorStore((state) => state.future.length > 0);
  const hasPristine = usePlanEditorStore((state) => state.pristine !== null);
  const undo = usePlanEditorStore((state) => state.undo);
  const redo = usePlanEditorStore((state) => state.redo);
  const resetToConcept = usePlanEditorStore((state) => state.resetToConcept);
  /* History belongs to the run while it holds the plan; its own controls are in the AI panel. */
  const aiActive = useAiRunStore(selectRunActive);
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);

  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const TOGGLES = [
    {
      id: 'snap',
      label: 'Snap',
      title: 'Snap placement to the grid and to alignment guides',
      icon: <Magnet aria-hidden className="h-4 w-4" />,
      on: snapEnabled,
      onClick: toggleSnap,
    },
    {
      id: 'grid',
      label: 'Grid',
      title: 'Show the measuring grid',
      icon: <Grid3x3 aria-hidden className="h-4 w-4" />,
      on: gridVisible,
      onClick: toggleGrid,
    },
    /*
     * Zones, off by default and deliberately so. They are scaffolding for "which parts do you want
     * designed", and once that is answered writing "Back garden ~ 18 m2" across a finished design
     * is a note about the tool rather than about the garden. The toggle exists because a user
     * checking their own answer had no way to see them again on any screen.
     */
    {
      id: 'zones',
      label: 'Zones',
      title: 'Tint the front, back and side gardens',
      icon: <LayoutGrid aria-hidden className="h-4 w-4" />,
      on: zonesVisible,
      onClick: toggleZones,
    },
    {
      id: 'dimensions',
      label: 'Dimensions',
      title: 'Measure the plot along each side',
      icon: <Ruler aria-hidden className="h-4 w-4" />,
      on: dimensionsVisible,
      onClick: toggleDimensions,
    },
    /*
     * Labels off is for judging how the garden looks; labels on is for reading it as a document.
     * A viewing preference like the grid, so it is not saved with the plan.
     */
    {
      id: 'labels',
      label: 'Labels',
      title: 'Name the things on the plan',
      icon: <Tag aria-hidden className="h-4 w-4" />,
      on: labelsVisible,
      onClick: toggleLabels,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolbarGroup>
        {VIEWS.map((item) => (
          <ToolbarButton
            key={item.id}
            testId={`view-${item.id}`}
            label={item.label}
            icon={null}
            pressed={view === item.id}
            title={
              item.id === 'plan'
                ? 'The accurate, editable plan'
                : 'A large clean render of the same plan'
            }
            onClick={() => setView(item.id)}
          />
        ))}
      </ToolbarGroup>

      {view === 'plan' ? <>
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

      <details className="relative">
        <summary className="cursor-pointer rounded-lg border border-garden-line bg-white px-3 py-2 text-xs text-garden-ink">
          Edit actions
        </summary>
        <div className="absolute top-full left-0 z-20 mt-2 rounded-lg bg-white p-2 shadow-lg">
          {' '}
          <ToolbarGroup>
            <ToolbarButton
              testId="editor-undo"
              label="Undo"
              icon={<Undo2 aria-hidden className="h-4 w-4" />}
              disabled={!canUndo || aiActive}
              onClick={undo}
            />
            <ToolbarButton
              testId="editor-redo"
              label="Redo"
              icon={<Redo2 aria-hidden className="h-4 w-4" />}
              disabled={!canRedo || aiActive}
              onClick={redo}
            />
            <ToolbarButton
              testId="editor-reset"
              label="Reset"
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
              disabled={!hasPristine || aiActive}
              title="Back to the concept as generated, discarding your edits"
              onClick={resetToConcept}
            />
            <DownloadPlanButton view="visualise" />
          </ToolbarGroup>
        </div>
      </details>

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
            {/* Furniture is placed by symbol from the palette, not as a bare category. */}
            {ADDABLE_CATEGORIES.filter((category) => category !== 'furniture').map((category) => (
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

      {/*
        The view switches, all four of the same shape.
        
        They were four verbatim copies of a twenty-five-line button, which is fine at two and a
        liability at four: the next one to be added is the one whose active-state class gets
        mistyped. One component, one list.
      */}
      <details className="relative">
        <summary className="cursor-pointer rounded-lg border border-garden-line bg-white px-3 py-2 text-xs text-garden-ink">
          View settings
        </summary>
        <div className="absolute top-full right-0 z-20 mt-2 flex w-48 flex-col gap-1 rounded-lg border border-garden-line bg-white p-2 shadow-lg">
          {TOGGLES.map((toggle) => (
            <ViewToggle
              key={toggle.id}
              testId={`editor-${toggle.id}`}
              label={toggle.label}
              title={toggle.title}
              icon={toggle.icon}
              on={toggle.on}
              onClick={toggle.onClick}
            />
          ))}
        </div>
      </details>

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
      </> : <span className="ml-auto text-xs text-garden-muted">Garden presentation</span>}
    </div>
  );
}

/**
 * One view switch: an icon, a name and an ON/OFF pill.
 *
 * Extracted when the fourth was added. `ToolbarButton` is deliberately not reused — that one is a
 * *mode* button, where pressing it changes what a click on the canvas does, and these change only
 * what is drawn. Reading the same in both places would say the two are the same kind of control.
 */
function ViewToggle({
  testId,
  label,
  title,
  icon,
  on,
  onClick,
}: {
  testId: string;
  label: string;
  title: string;
  icon: React.ReactNode;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={[
        'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium shadow-sm transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        on
          ? 'border-garden-forest bg-garden-forest text-white'
          : 'border-garden-line bg-white text-garden-muted hover:border-garden-green',
      ].join(' ')}
    >
      {icon}
      {label}
      <span
        className={[
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
          on ? 'bg-white/20 text-white' : 'bg-garden-line text-garden-muted',
        ].join(' ')}
      >
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
