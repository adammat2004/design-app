'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageOff, Sparkles } from 'lucide-react';
import { draftPolygon } from '@/lib/boundary-geometry';
import { exportPlanPng } from '@/lib/materials/export-plan';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { DownloadPlanButton } from '../DownloadPlanButton';

/**
 * The Visualise tab: the same plan, large and clean.
 *
 * ## What this is, and what it is not
 *
 * The tab has sat in the toolbar greyed out since the editor was built, promising a photorealistic
 * view that is a whole architecture away — a scene hash, a camera model, a provider abstraction and
 * somebody's API budget. That is real work and it is planned; it is not what makes the tab worth
 * having today.
 *
 * What is worth having today is the plan **without the editor on top of it**. Every canvas in the
 * wizard is an editing surface: handles, guides, a grid, a selection outline, chips naming things.
 * They are all correct and they are all in the way when the question is "does my garden look
 * right". This draws through `drawPlan` — the same composer the concept cards and the PNG export
 * use, so it is the same picture at a larger size with none of the furniture.
 *
 * ## Why it is honest to ship it as "Visualise"
 *
 * Because it says what it is. The empty-state copy names the photorealistic view as *coming*, and
 * nothing here is labelled or shaped as an AI render. When the generative layer lands it fills this
 * panel rather than adding a concept — which is the whole reason for building the shell first.
 */
export function VisualisePanel() {
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const labelsVisible = usePlanEditorStore((state) => state.labelsVisible);

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    let live = true;

    /*
     * Redrawn whenever the plan changes, at export resolution.
     *
     * A full composer pass is far too slow for a canvas that repaints on every drag — which is why
     * the editor uses Konva and this does not. It is fine here: this tab is a place you arrive at,
     * not one you edit in, and it draws once per visit.
     */
    void (async () => {
      setFailed(false);
      try {
        const blob = await exportPlanPng(
          {
            boundary: draftPolygon(boundaryDraft),
            house: boundaryDraft.house,
            elements,
            site: boundaryDraft,
          },
          { unit, labels: labelsVisible },
        );
        if (!live) return;

        const next = URL.createObjectURL(blob);
        // Released only once its replacement exists, or the image blanks between renders.
        if (previous.current) URL.revokeObjectURL(previous.current);
        previous.current = next;
        setUrl(next);
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [boundaryDraft, elements, unit, labelsVisible]);

  useEffect(
    () => () => {
      if (previous.current) URL.revokeObjectURL(previous.current);
    },
    [],
  );

  return (
    <div
      data-testid="visualise-panel"
      className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-garden-forest">
            <Sparkles aria-hidden className="h-4 w-4 text-garden-green" />
            Your garden, drawn clean
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-garden-muted">
            The same plan without the editor over it — no grid, no handles, no selection. A
            photorealistic view of this design is coming; this is the drawing it will be made from.
          </p>
        </div>
        <DownloadPlanButton variant="primary" />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-garden-sage/40 p-4">
        {failed ? (
          <p
            data-testid="visualise-failed"
            className="flex items-center gap-2 text-xs text-garden-muted"
          >
            <ImageOff aria-hidden className="h-4 w-4" />
            The drawing could not be rendered. Try again from the Plan tab.
          </p>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an optimisable asset
          <img
            src={url}
            alt="The garden plan"
            data-testid="visualise-image"
            className="max-h-full w-auto max-w-full rounded shadow-sm"
          />
        ) : (
          <p className="text-xs text-garden-muted">Drawing your plan…</p>
        )}
      </div>
    </div>
  );
}
