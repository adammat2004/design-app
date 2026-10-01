'use client';

import { Pentagon, Spline, Square } from 'lucide-react';
import type { ElementCategory } from '@garden-studio/schema';
import { usePlanEditorStore, type PlacingTool } from '@/state/plan-editor-store';

/**
 * The strip over the plan while something is armed: what is being placed, and — for a plain surface
 * — how it is put down.
 *
 * A patio used to arrive as a three-metre square wherever the click landed, and a path could not be
 * drawn at all. **Rectangle** is the default and keeps that click (a drag sizes it); **Shape** is
 * drawn corner by corner; **Path** is drawn along its line, and is offered only for the two surfaces
 * a path is made of. A symbol — a bench, a tree — has no tools: it is placed, never drawn.
 */
const TOOLS: { id: PlacingTool; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'rect', label: 'Rectangle', hint: 'Drag to size it, or click for the default', icon: <Square aria-hidden className="h-3.5 w-3.5" /> },
  { id: 'polygon', label: 'Shape', hint: 'Click each corner; click the first to close', icon: <Pentagon aria-hidden className="h-3.5 w-3.5" /> },
  { id: 'polyline', label: 'Path', hint: 'Click along it; double-click to finish', icon: <Spline aria-hidden className="h-3.5 w-3.5" /> },
];

const PATH_CATEGORIES: ElementCategory[] = ['paved-area', 'gravel-mulch'];

export function DrawToolStrip({
  category,
  label,
  drawable,
}: {
  category: ElementCategory;
  label: string;
  drawable: boolean;
}) {
  const tool = usePlanEditorStore((state) => state.placingTool);
  const points = usePlanEditorStore((state) => state.draftPoints.length);
  const setTool = usePlanEditorStore((state) => state.setPlacingTool);
  /* A fence or a wall is only ever drawn along its line — a box of fence is not a thing. */
  const line = category === 'enclosure';
  const tools = line
    ? TOOLS.filter((entry) => entry.id === 'polyline').map((entry) => ({
        ...entry,
        label: 'Line',
        hint: 'Click along it — it snaps to the fence line; double-click to finish',
      }))
    : TOOLS.filter((entry) => entry.id !== 'polyline' || PATH_CATEGORIES.includes(category));
  const active = tools.find((entry) => entry.id === tool) ?? tools[0]!;
  const canFinish = tool === 'polygon' ? points >= 3 : tool === 'polyline' ? points >= 2 : false;

  return (
    <div
      data-testid="draw-tool-strip"
      data-points={points}
      className="pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-garden-forest py-1 pr-1 pl-4 text-xs text-white shadow-sm"
    >
      <span className="font-semibold whitespace-nowrap">
        {drawable ? `${active.hint} — ${label}` : `Click the plan to place ${label}`}
      </span>
      <span className="whitespace-nowrap text-white/75">· Shift for several · Esc to stop</span>

      {drawable ? (
        <div role="radiogroup" aria-label="How to put it down" className="flex items-center gap-0.5 rounded-full bg-white/10 p-0.5">
          {tools.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === tool}
              data-testid={`draw-tool-${entry.id}`}
              title={entry.hint}
              onClick={() => setTool(entry.id)}
              className={[
                'flex items-center gap-1 rounded-full px-2.5 py-1 font-medium',
                'focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none',
                entry.id === tool ? 'bg-white text-garden-forest' : 'text-white hover:bg-white/15',
              ].join(' ')}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {canFinish ? (
        <button
          type="button"
          data-testid="draw-finish"
          onClick={() => usePlanEditorStore.getState().finishDraft()}
          className="rounded-full bg-white px-3 py-1 font-semibold text-garden-forest hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          {tool === 'polygon' ? 'Close shape' : 'Finish path'}
        </button>
      ) : null}
    </div>
  );
}
