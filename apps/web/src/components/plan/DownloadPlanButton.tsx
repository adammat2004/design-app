'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { draftPolygon } from '@/lib/boundary-geometry';
import { downloadPlanPng, planFileName } from '@/lib/materials/export-plan';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { ToolbarButton } from './ToolbarButton';

/**
 * Downloads the plan as a PNG, drawn by the same composer the concept cards use.
 *
 * Reads the stores directly rather than taking a scene, so the editor's toolbar and the review
 * screen cannot hand it two different gardens. Whatever is on the plan right now is what goes in
 * the file, including edits the autosave has not flushed — the picture is of the screen.
 */
export function DownloadPlanButton({ variant = 'toolbar' }: { variant?: 'toolbar' | 'primary' }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    const boundaryDraft = useBoundaryStore.getState().present;
    const { unit, projectName } = useBoundaryStore.getState();
    const editor = usePlanEditorStore.getState();

    setBusy(true);
    setFailed(false);
    try {
      await downloadPlanPng(
        {
          boundary: draftPolygon(boundaryDraft),
          house: boundaryDraft.house,
          elements: editor.present.elements,
          site: boundaryDraft,
        },
        { unit, labels: editor.labelsVisible, fileName: planFileName(projectName) },
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'primary') {
    return (
      <button
        type="button"
        data-testid="download-plan"
        disabled={busy}
        onClick={download}
        className="flex items-center gap-2 rounded-xl border border-garden-line bg-white px-4 py-2.5 text-sm font-medium text-garden-ink shadow-sm transition-colors hover:border-garden-green hover:bg-garden-sage/50 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:opacity-60"
      >
        <Download aria-hidden className="h-4 w-4" />
        {busy ? 'Drawing…' : failed ? 'Could not export — try again' : 'Download plan (PNG)'}
      </button>
    );
  }

  return (
    <ToolbarButton
      testId="download-plan"
      label={busy ? 'Drawing…' : 'Download'}
      icon={<Download aria-hidden className="h-4 w-4" />}
      disabled={busy}
      title={failed ? 'The export failed — try again' : 'Save the plan as a PNG'}
      onClick={download}
    />
  );
}
