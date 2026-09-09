'use client';

import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';
import { MATURITY_LABELS, MATURITY_ORDER } from '@/lib/render/maturity';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { DownloadPlanButton } from '../DownloadPlanButton';

/*
 * WebGL, and therefore browser-only. Loaded the way every Konva canvas is and for the same
 * reason — it cannot server-render — with the second benefit that 2D Plan never downloads Pixi.
 */
const VisualiseView = dynamic(
  () => import('./VisualiseView').then((module) => module.VisualiseView),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden className="min-h-0 flex-1 animate-pulse rounded-lg bg-garden-sage/40" />
    ),
  },
);

const MINUTES_IN_DAY = 24 * 60;

function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

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
  const sun = useBoundaryStore((state) => state.present.sun);
  const hasLocation = useBoundaryStore((state) => state.present.location !== null);
  const setSun = useBoundaryStore((state) => state.setSun);
  const maturity = usePlanEditorStore((state) => state.maturity);
  const setMaturity = usePlanEditorStore((state) => state.setMaturity);

  return (
    <div
      data-testid="visualise-panel"
      className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-garden-forest">
            <Sparkles aria-hidden className="h-4 w-4 text-garden-green" />
            Your garden, grown in
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-garden-muted">
            The same plan, planted densely and lit by the sun rather than by the drawing convention.
            Drag to pan, scroll to zoom. Nothing here changes the design.
          </p>
        </div>
        <DownloadPlanButton variant="primary" view="visualise" />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-garden-forest">Planting</span>
          <div
            role="radiogroup"
            aria-label="How grown in the planting is drawn"
            className="flex overflow-hidden rounded-md border border-garden-line"
          >
            {MATURITY_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={maturity === option}
                data-testid={`maturity-${option}`}
                onClick={() => setMaturity(option)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  maturity === option
                    ? 'bg-garden-green text-white'
                    : 'bg-white text-garden-muted hover:bg-garden-sage/40'
                }`}
              >
                {MATURITY_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        {/*
          The time of day, only where the plan knows where on Earth it is. With no location there
          is no solar position to move, so a slider would be a control that changes nothing —
          exactly the false claim `site.location` being nullable exists to avoid.
        */}
        {hasLocation ? (
          <label className="flex items-center gap-2 text-xs font-medium text-garden-forest">
            Time
            <input
              type="range"
              min={0}
              max={MINUTES_IN_DAY - 15}
              step={15}
              value={sun.minutes}
              data-testid="sun-time"
              onChange={(event) => setSun({ minutes: Number(event.target.value) })}
              className="w-40 accent-garden-green"
            />
            <span className="w-10 tabular-nums text-garden-muted">{clockLabel(sun.minutes)}</span>
          </label>
        ) : (
          <p className="text-xs text-garden-muted">
            Set a location in step 1 to light the garden by the real sun.
          </p>
        )}
      </div>

      <VisualiseView />
    </div>
  );
}
