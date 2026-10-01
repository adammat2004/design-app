'use client';

import { Box } from 'lucide-react';
import { PLAN_DOCUMENT_VERSION } from '@garden-studio/schema';
import { sceneFileName, sceneOfPlan } from '@/lib/ar/scene';
import { MODEL_LIBRARY } from '@/lib/structures/model-library';
import { edgeRulesNow } from '@/lib/edge-rules';
import { downloadBlob } from '@/lib/materials/export-plan';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { projectRevision } from '@/state/revision';
import { ToolbarButton } from './ToolbarButton';

/**
 * Writes this plan as the scene a phone reads (`.ar.json`), for the AR app's file source — real
 * designs on a phone with no network exposure, until the API is safe to reach from one.
 *
 * Development only, like the AI demonstration: it is a tool for building the AR viewer, not a
 * thing a garden owner has any use for yet. It is the design, not the view — hidden groups are
 * included — and it carries the phone's plant budget, because that is what the phone will draw.
 */
export function DownloadArSceneButton() {
  if (process.env.NODE_ENV === 'production') return null;

  const download = () => {
    const { present: site, projectName } = useBoundaryStore.getState();
    const revision = projectRevision();
    const { scene } = sceneOfPlan(
      {
        site,
        elements: usePlanEditorStore.getState().present.elements,
        edgeRules: edgeRulesNow(),
        projectName,
        projectId: revision?.projectId ?? null,
        revision: revision?.revision ?? null,
        documentVersion: PLAN_DOCUMENT_VERSION,
      },
      'phone',
      // Whatever of the model library has loaded: a phone without it draws the parts regardless.
      MODEL_LIBRARY.get(),
    );
    downloadBlob(new Blob([JSON.stringify(scene)], { type: 'application/json' }), sceneFileName(projectName));
  };

  return (
    <ToolbarButton
      testId="download-ar-scene"
      label="AR scene"
      icon={<Box aria-hidden className="h-4 w-4" />}
      title="Download this plan as the scene the AR app reads (development only)"
      onClick={download}
    />
  );
}
