'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Map as MapIcon } from 'lucide-react';
import { PLAN_DOCUMENT_VERSION, structureDefinitionFor } from '@garden-studio/schema';
import { sceneOfPlan } from '@/lib/ar/scene';
import { useEdgeRules } from '@/lib/edge-rules';
import { previewCounts, sceneFrameOf, type PreviewView } from '@/lib/ar/preview';
import { useCoarsePointer } from '@/lib/structures/coarse-pointer';
import { useLibraryModelsStatus, useModelLibrary } from '@/lib/structures/model-library';
import { sunInFrame } from '@/lib/structures/sun-3d';
import { webglAvailable } from '@/lib/structures/webgl';
import { useBoundaryStore } from '@/state/boundary-store';
import { useGardenPreviewStore } from '@/state/garden-preview-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { projectRevision } from '@/state/revision';
import type { DrawnBox } from '../three/LibraryModel';
import type { ViewportReport } from '../three/SceneAtmosphere';
import { GardenViewport } from './GardenViewport';

const VIEWS: { id: PreviewView; label: string; icon: typeof Eye }[] = [
  { id: 'door', label: 'From the door', icon: Eye },
  { id: 'overview', label: 'Overview', icon: MapIcon },
];

/**
 * The whole garden in 3D, over whichever screen opened it: a look at the design, never a place to
 * change it. The plan is where geometry changes; a pergola or a gazebo opens in its own editor
 * (`onOpenStructure`, where the screen has one).
 *
 * The scene is built from the plan **as it stands**, saved or not, by the same builder the phone's
 * scene comes from — at the desktop's plant budget, so the borders are as full as the plan draws
 * them. It is built when the preview opens and again only if the plan changes under it.
 */
export function GardenPreview({ onOpenStructure }: { onOpenStructure?: (elementId: string) => void }) {
  const close = useGardenPreviewStore((state) => state.closePreview);
  const site = useBoundaryStore((state) => state.present);
  const projectName = useBoundaryStore((state) => state.projectName);
  const elements = usePlanEditorStore((state) => state.present.elements);
  // The brief's style decides what automatic edging lays, as it does on the plan.
  const edgeRules = useEdgeRules();
  // The model library once it has loaded; until then every structure draws its own parts.
  const library = useModelLibrary();
  const libraryModels = useLibraryModelsStatus();

  const { scene, skipped } = useMemo(() => {
    const revision = projectRevision();
    return sceneOfPlan(
      {
        site,
        elements,
        edgeRules,
        projectName,
        projectId: revision?.projectId ?? null,
        revision: revision?.revision ?? null,
        documentVersion: PLAN_DOCUMENT_VERSION,
      },
      'desktop',
      library,
    );
  }, [site, elements, edgeRules, projectName, library]);
  const counts = useMemo(() => previewCounts(scene), [scene]);
  const sun = useMemo(() => sunInFrame(site, sceneFrameOf(scene)), [site, scene]);
  const pickable = useMemo(
    () =>
      new Set(
        onOpenStructure ? elements.filter((element) => structureDefinitionFor(element)).map((element) => element.id) : [],
      ),
    [elements, onOpenStructure],
  );

  const [webgl] = useState(webglAvailable);
  const coarse = useCoarsePointer();
  const [view, setView] = useState<PreviewView>('door');
  const [viewKey, setViewKey] = useState(0);
  const [report, setReport] = useState<ViewportReport | null>(null);
  /** Where each library model was actually drawn, by source element — the test hook for alignment. */
  const [drawn, setDrawn] = useState<Record<string, DrawnBox>>({});
  const onAssetDrawn = useCallback((sourceId: string, box: DrawnBox | null) => {
    setDrawn((current) => {
      const next = { ...current };
      if (box) next[sourceId] = box;
      else delete next[sourceId];
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const fly = (next: PreviewView) => {
    setView(next);
    setViewKey((key) => key + 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="garden-preview-title"
      data-testid="garden-preview"
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-garden-line px-4 py-2.5">
        <button
          type="button"
          data-testid="garden-preview-close"
          onClick={close}
          className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:border-garden-green hover:bg-garden-sage"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="min-w-0">
          <h2 id="garden-preview-title" className="truncate text-sm font-semibold text-garden-forest">
            Your garden in 3D
          </h2>
          <p data-testid="garden-preview-note" className="text-[11px] text-garden-muted">
            A preview to look around — change the design on the plan
          </p>
        </div>
      </div>

      <div
        data-testid="garden-preview-viewport"
        data-surfaces={counts.surfaces}
        data-solids={counts.solids}
        data-models={counts.models}
        data-plants={counts.plants}
        data-assets={counts.assets}
        data-assets-drawn={Object.keys(drawn).length}
        data-asset-boxes={JSON.stringify(drawn)}
        data-library={library ? `${library.entries.length}` : ''}
        data-library-models={libraryModels}
        data-skipped={skipped.length}
        data-origin={scene.frame.origin.kind}
        data-view={view}
        data-webgl={String(webgl)}
        data-render-tier={report?.tier ?? ''}
        data-sky={report?.sky ?? ''}
        className="relative min-h-0 flex-1 bg-slate-100"
      >
        {webgl ? (
          <GardenViewport
            scene={scene}
            sun={sun}
            view={view}
            viewKey={viewKey}
            pickable={pickable}
            onPick={
              onOpenStructure
                ? (id) => {
                    close();
                    onOpenStructure(id);
                  }
                : undefined
            }
            coarse={coarse}
            onAssetDrawn={onAssetDrawn}
            onReport={setReport}
          />
        ) : (
          <div
            role="status"
            data-testid="garden-preview-no-webgl"
            className="flex h-full items-center justify-center px-6 text-center text-sm text-garden-muted"
          >
            3D isn&apos;t available in this browser. The plan shows everything the preview would.
          </div>
        )}
        {webgl && pickable.size > 0 ? (
          <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-garden-ink shadow-sm backdrop-blur">
            {coarse ? 'Tap a pergola to configure it' : 'Click a pergola or gazebo to configure it'}
          </p>
        ) : null}
        <div className="absolute bottom-3 left-3 flex gap-1 rounded-full border border-garden-line bg-white/90 p-1 shadow-sm backdrop-blur">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`garden-preview-view-${option.id}`}
              aria-pressed={view === option.id}
              onClick={() => fly(option.id)}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
                view === option.id ? 'bg-garden-forest text-white' : 'text-garden-ink hover:bg-garden-sage'
              }`}
            >
              <option.icon aria-hidden className="h-3.5 w-3.5" />
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
