'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import {
  boundaryEdges,
  draftPolygon,
  edgeLength,
  edgeReflowTargets,
  vertexLabel,
} from '@/lib/boundary-geometry';
import { formatLengthValue, fromDisplay, type Unit } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

export function SideLengthsPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const setEdgeLength = useBoundaryStore((state) => state.setEdgeLength);
  const select = useBoundaryStore((state) => state.select);
  const previewEdgeReflow = useBoundaryStore((state) => state.previewEdgeReflow);

  const polygon = draftPolygon(draft);
  const edges = boundaryEdges(polygon, draft.closed);
  const vertexCount = polygon.length;

  return (
    <section className="space-y-3 border-t border-garden-line pt-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-garden-ink">
        Side lengths
        <span title="Typing a length pins one corner and slides the next one along the same line. The plan shows which is which.">
          <Info aria-hidden className="h-3.5 w-3.5 text-garden-muted" />
        </span>
      </h2>

      {edges.length === 0 ? (
        <p className="text-xs text-garden-muted">
          Sides appear here once you have placed two corners.
        </p>
      ) : (
        <ul data-testid="side-lengths" className="space-y-2">
          {edges.map((edge) => {
            const from = vertexLabel(edge.index);
            const to = vertexLabel((edge.index + 1) % vertexCount);

            return (
              <li key={edge.index} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-garden-muted">
                  {from} <span aria-hidden>→</span>
                  <span className="sr-only">to</span> {to}
                </span>

                <LengthInput
                  testId={`side-length-${edge.index}`}
                  label={`Length of side ${from} to ${to}`}
                  metres={edgeLength(edge.start, edge.end)}
                  unit={unit}
                  /*
                   * Selects the corner that will *move*, not the one the side starts at. For the
                   * closing edge those are different — see `edgeReflowTargets` — and highlighting
                   * the pinned corner would point at the one thing guaranteed to stay put.
                   */
                  onFocus={() => {
                    previewEdgeReflow(edge.index);
                    const targets = edgeReflowTargets(vertexCount, edge.index);
                    const moved = targets && draft.vertices[targets.movedIndex];
                    if (moved) select({ kind: 'vertex', id: moved.id });
                  }}
                  onBlur={() => previewEdgeReflow(null)}
                  onCommit={(metres) => setEdgeLength(edge.index, metres)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Holds a string while the field has focus so half-typed values like "1." never reach the
 * store, and resyncs from the canvas the moment focus leaves — this is the editable half of
 * the two-way binding.
 */
export function LengthInput({
  testId,
  label,
  metres,
  unit,
  allowNegative,
  onFocus,
  onBlur,
  onCommit,
}: {
  testId: string;
  label: string;
  metres: number;
  unit: Unit;
  allowNegative?: boolean;
  onFocus?: () => void;
  /** Fires after the commit, so a caller can clear whatever `onFocus` put on screen. */
  onBlur?: () => void;
  onCommit: (metres: number) => void;
}) {
  const [text, setText] = useState(() => formatLengthValue(metres, unit));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(formatLengthValue(metres, unit));
  }, [metres, unit]);

  function commit() {
    const typed = Number(text);
    const valid = Number.isFinite(typed) && (allowNegative || typed > 0);

    if (!valid) {
      setText(formatLengthValue(metres, unit));
      return;
    }

    /*
     * Blur fires whenever focus leaves, including on the way to pressing Undo. Committing an
     * untouched value would push a no-op onto the history stack — and, because the field is
     * rounded to one decimal place, would also snap the real geometry to that rounding.
     */
    if (text === formatLengthValue(metres, unit)) return;

    onCommit(fromDisplay(typed, unit));
  }

  return (
    <span className="flex flex-1 items-center gap-1 rounded-md border border-garden-line bg-white px-2 py-1 focus-within:border-garden-green">
      <input
        type="number"
        inputMode="decimal"
        min={allowNegative ? undefined : 0.1}
        step={0.1}
        data-testid={testId}
        aria-label={label}
        value={text}
        onFocus={() => {
          focused.current = true;
          onFocus?.();
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className="w-full min-w-0 bg-transparent text-sm text-garden-ink focus-visible:outline-none"
      />
      <span className="shrink-0 text-[11px] text-garden-muted">{unit}</span>
    </span>
  );
}
