'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, Undo2 } from 'lucide-react';
import { resolveStructure } from '@garden-studio/schema';
import { formatLengthValue } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { StructureInspector } from './StructureInspector';
import { StructureViewport, type CameraPreset } from './StructureViewport';

/**
 * The focused 3D editor for one structure: a large viewport and its settings, and nothing else.
 *
 * Opened from the inspector's "Edit in 3D", as a workspace state of the editor rather than a route
 * (see `structureEdit` in the store): the plan stays mounted behind it, so its undo history, its
 * autosave and wherever the user had panned to are all still there on the way back.
 *
 * **It is the same element.** Nothing here is a copy, so "Back to plan" and "Done" do the same thing
 * — close — and neither can lose or discard work: every change was an ordinary edit the moment it
 * was made, and Undo takes them back one at a time here or on the plan.
 */
const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
];

export function StructureWorkspace({ elementId }: { elementId: string }) {
  const element = usePlanEditorStore((state) => state.present.elements.find((item) => item.id === elementId) ?? null);
  const close = usePlanEditorStore((state) => state.closeStructureEdit);
  const undo = usePlanEditorStore((state) => state.undo);
  const canUndo = usePlanEditorStore((state) => state.past.length > 0);
  const unit = useBoundaryStore((state) => state.unit);
  const structure = useMemo(() => (element ? resolveStructure(element) : null), [element]);
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [presetKey, setPresetKey] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape' && !typing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /* The element can go — an Undo past its creation — and then there is nothing to configure. */
  if (!element || !structure) return null;

  const fly = (next: CameraPreset) => {
    setPreset(next);
    setPresetKey((key) => key + 1);
  };
  const size = `${formatLengthValue(structure.width, unit)} × ${formatLengthValue(structure.depth, unit)} ${unit}`;
  const rotation = element.shape.kind === 'rect' ? Math.round(element.shape.rotation) % 360 : 0;

  return (
    <div data-testid="structure-workspace" className="flex min-h-0 flex-1 flex-col bg-white lg:flex-row">
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-garden-line px-4 py-2.5">
          <button
            type="button"
            data-testid="structure-back"
            onClick={close}
            className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:border-garden-green hover:bg-garden-sage"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Back to plan
          </button>
          <div className="min-w-0">
            <h2 data-testid="structure-title" className="truncate text-sm font-semibold text-garden-forest">
              {element.name ?? structure.definition.label}
            </h2>
            <p data-testid="structure-footprint" className="text-[11px] text-garden-muted">
              {structure.definition.label} · {size} · turned {rotation}° on the plan
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-testid="structure-undo"
              onClick={undo}
              disabled={!canUndo}
              className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:bg-garden-sage disabled:opacity-40"
            >
              <Undo2 aria-hidden className="h-3.5 w-3.5" />
              Undo
            </button>
            <button
              type="button"
              data-testid="structure-done"
              onClick={close}
              className="flex items-center gap-1.5 rounded-full bg-garden-forest px-4 py-1.5 text-xs font-semibold text-white hover:bg-garden-green"
            >
              <Check aria-hidden className="h-3.5 w-3.5" />
              Done
            </button>
          </div>
        </div>

        <div
          data-testid="structure-viewport"
          data-width={structure.width}
          data-depth={structure.depth}
          data-height={structure.height}
          data-preset={structure.preset}
          data-model={structure.model}
          data-roof={structure.roof.kind}
          data-lighting={String(structure.lighting)}
          data-camera={preset}
          className="relative min-h-0 flex-1 bg-slate-100"
        >
          <StructureViewport structure={structure} preset={preset} presetKey={presetKey} />
          <div className="absolute bottom-3 left-3 flex gap-1 rounded-full border border-garden-line bg-white/90 p-1 shadow-sm backdrop-blur">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`structure-camera-${option.id}`}
                aria-pressed={preset === option.id}
                onClick={() => fly(option.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  preset === option.id ? 'bg-garden-forest text-white' : 'text-garden-ink hover:bg-garden-sage'
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              data-testid="structure-camera-reset"
              aria-label="Reset camera"
              title="Reset camera"
              onClick={() => fly('orbit')}
              className="rounded-full px-2 py-1 text-garden-muted hover:bg-garden-sage hover:text-garden-ink"
            >
              <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-t border-garden-line lg:w-80 lg:border-t-0 lg:border-l xl:w-96">
        <StructureInspector key={element.id} element={element} structure={structure} unit={unit} />
      </aside>
    </div>
  );
}
