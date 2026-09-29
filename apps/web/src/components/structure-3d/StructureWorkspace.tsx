'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Check, RotateCcw, Trees, Undo2 } from 'lucide-react';
import {
  lightDirection,
  localFrame,
  resolveStructure,
  structureNeighbourhood,
} from '@garden-studio/schema';
import { sunInFrame } from '@/lib/structures/sun-3d';
import { webglAvailable } from '@/lib/structures/webgl';
import { tabForPart } from '@/lib/structures/part-tabs';
import { formatLengthValue } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { StructureInspector, structureTabs, type InspectorRequest } from './StructureInspector';
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

/*
 * A finger has one gesture and the orbit already has it, so on a coarse pointer the resize handles are
 * not drawn at all: the Size tab is the whole path there, as it is for a keyboard. A tap on a part
 * still opens its tab, because a tap is not a drag.
 */
const COARSE = '(pointer: coarse)';
function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia?.(COARSE);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const coarseNow = () => window.matchMedia?.(COARSE).matches ?? false;
const coarseOnServer = () => false;

export function StructureWorkspace({ elementId }: { elementId: string }) {
  const element = usePlanEditorStore(
    (state) => state.present.elements.find((item) => item.id === elementId) ?? null,
  );
  const close = usePlanEditorStore((state) => state.closeStructureEdit);
  const undo = usePlanEditorStore((state) => state.undo);
  const canUndo = usePlanEditorStore((state) => state.past.length > 0);
  const unit = useBoundaryStore((state) => state.unit);
  const structure = useMemo(() => (element ? resolveStructure(element) : null), [element]);
  /*
   * The garden around it — the ground it stands on, the fence, the house, a tree, the table under
   * it — so a size or a screen is judged against the place rather than against an empty lawn. A view
   * preference like the camera, so it lives here and never in the document.
   */
  const elements = usePlanEditorStore((state) => state.present.elements);
  const site = useBoundaryStore((state) => state.present);
  const pieceId = usePlanEditorStore((state) => state.structureEdit?.pieceId ?? null);
  const selectPiece = usePlanEditorStore((state) => state.selectPiece);
  /*
   * The surroundings are drawn from the plan as it stood when a drag began, as the editor canvas
   * holds its neighbouring beds still: dragging a chair must not re-plant every border each frame.
   * What is inside the structure is read live, because that is what is being moved.
   */
  const gestureSnapshot = usePlanEditorStore((state) => state.gestureSnapshot);
  const settled = gestureSnapshot?.elements ?? elements;
  const [surroundings, setSurroundings] = useState(true);
  const neighbourhood = useMemo(
    () => (element ? structureNeighbourhood(element, { elements: settled, site }) : null),
    [element, settled, site],
  );
  const interior = useMemo(
    () =>
      element
        ? (structureNeighbourhood(element, { elements, site }, { reach: 0 })?.interior ?? [])
        : [],
    [element, elements, site],
  );
  const frame = useMemo(() => (element ? localFrame(element) : null), [element]);
  const sun = useMemo(() => (frame ? sunInFrame(site, frame) : null), [site, frame]);
  const light = useMemo(() => lightDirection(site) ?? undefined, [site]);
  const shown = surroundings ? neighbourhood : null;
  // Asked once: a browser either has WebGL or it does not, and the answer decides what is mounted.
  const [webgl] = useState(webglAvailable);
  const coarse = useSyncExternalStore(subscribeCoarse, coarseNow, coarseOnServer);
  const [request, setRequest] = useState<InspectorRequest | null>(null);
  // Taught once and then out of the way: the first click on a part shows the idea has landed.
  const [hinted, setHinted] = useState(false);
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [presetKey, setPresetKey] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'SELECT' ||
        target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape' && !typing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /* The element can go — an Undo past its creation — and then there is nothing to configure. */
  if (!element || !structure || !frame || !sun) return null;

  const fly = (next: CameraPreset) => {
    setPreset(next);
    setPresetKey((key) => key + 1);
  };
  const size = `${formatLengthValue(structure.width, unit)} × ${formatLengthValue(structure.depth, unit)} ${unit}`;
  const rotation = element.shape.kind === 'rect' ? Math.round(element.shape.rotation) % 360 : 0;

  return (
    <div
      data-testid="structure-workspace"
      className="flex min-h-0 flex-1 flex-col bg-white lg:flex-row"
    >
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
            <h2
              data-testid="structure-title"
              className="truncate text-sm font-semibold text-garden-forest"
            >
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
          data-surroundings={shown ? 'on' : 'off'}
          data-context-surfaces={shown?.surfaces.length ?? 0}
          data-context-solids={(shown?.solids.length ?? 0) + (shown?.house ? 1 : 0)}
          data-context-plants={shown?.plants.length ?? 0}
          data-interior={interior.length}
          data-piece={pieceId ?? ''}
          data-floor={structure.floor ?? ''}
          data-webgl={String(webgl)}
          className="relative min-h-0 flex-1 bg-slate-100"
        >
          {webgl ? (
            <StructureViewport
              structure={structure}
              element={element}
              elements={settled}
              frame={frame}
              neighbourhood={shown}
              interior={interior}
              pieceId={pieceId}
              sun={sun}
              light={light}
              preset={preset}
              presetKey={presetKey}
              onMissed={() => selectPiece(null)}
              onPick={(group) => {
                setHinted(true);
                const tab = tabForPart(group, structureTabs(structure));
                if (tab) setRequest({ key: Date.now(), kind: 'tab', tab });
              }}
              handles={!coarse}
              onBlocked={(result) => setRequest({ key: Date.now(), kind: 'refused', result })}
            />
          ) : (
            /*
             * No 3D here, and nothing is lost by it: the settings beside this still edit the same
             * element, and the plan draws every one of them.
             */
            <div
              role="status"
              data-testid="structure-no-webgl"
              className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-garden-muted"
            >
              3D isn&apos;t available in this browser. Your changes still apply to the plan.
            </div>
          )}
          {webgl && !hinted ? (
            <p
              data-testid="structure-hint"
              className="pointer-events-none absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-garden-ink shadow-sm backdrop-blur"
            >
              {coarse
                ? 'Tap a part to edit it'
                : 'Click a part to edit it · drag a handle to resize'}
            </p>
          ) : null}
          <div className="absolute bottom-3 left-3 flex gap-1 rounded-full border border-garden-line bg-white/90 p-1 shadow-sm backdrop-blur">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`structure-camera-${option.id}`}
                aria-pressed={preset === option.id}
                onClick={() => fly(option.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  preset === option.id
                    ? 'bg-garden-forest text-white'
                    : 'text-garden-ink hover:bg-garden-sage'
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
            <span aria-hidden className="mx-0.5 w-px self-stretch bg-garden-line" />
            <button
              type="button"
              data-testid="structure-surroundings"
              aria-pressed={surroundings}
              title={surroundings ? 'Hide the garden around it' : 'Show the garden around it'}
              onClick={() => setSurroundings((on) => !on)}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
                surroundings
                  ? 'bg-garden-forest text-white'
                  : 'text-garden-ink hover:bg-garden-sage'
              }`}
            >
              <Trees aria-hidden className="h-3.5 w-3.5" />
              Surroundings
            </button>
          </div>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-t border-garden-line lg:w-80 lg:border-t-0 lg:border-l xl:w-96">
        <StructureInspector
          key={element.id}
          element={element}
          structure={structure}
          unit={unit}
          request={request}
        />
      </aside>
    </div>
  );
}
