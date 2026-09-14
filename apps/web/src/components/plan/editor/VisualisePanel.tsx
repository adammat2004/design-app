'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
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

export function VisualisePanel() {
  const sun = useBoundaryStore((state) => state.present.sun);
  const hasLocation = useBoundaryStore((state) => state.present.location !== null);
  const previewMinutes = usePlanEditorStore((state) => state.previewMinutes);
  const setPreviewMinutes = usePlanEditorStore((state) => state.setPreviewMinutes);
  const minutes = previewMinutes ?? sun.minutes;
  const maturity = usePlanEditorStore((state) => state.maturity);
  const setMaturity = usePlanEditorStore((state) => state.setMaturity);
  const pendingTime = useRef<number | null>(null);
  const timeFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (timeFrame.current !== null) cancelAnimationFrame(timeFrame.current);
  }, []);
  const previewTime = (value: number) => {
    pendingTime.current = value;
    if (timeFrame.current !== null) return;
    timeFrame.current = requestAnimationFrame(() => {
      timeFrame.current = null;
      if (pendingTime.current !== null) setPreviewMinutes(pendingTime.current);
    });
  };

  return (
    <div
      data-testid="visualise-panel"
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <h2 className="sr-only">Your garden, grown in</h2>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
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
              value={minutes}
              data-testid="sun-time"
              onChange={(event) => previewTime(Number(event.target.value))}
              className="w-40 accent-garden-green"
            />
            <span className="w-10 tabular-nums text-garden-muted">{clockLabel(minutes)}</span>
          </label>
        ) : (
          <p className="text-xs text-garden-muted">
            Presentation lighting
          </p>
        )}
        <div className="ml-auto"><DownloadPlanButton view="visualise" /></div>
      </div>

      <VisualiseView />
    </div>
  );
}
