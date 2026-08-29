'use client';

import { useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { formatLength, fromDisplay, toDisplay } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * Places the next corner from a measurement rather than from a click.
 *
 * The old flow was commit-then-correct: click roughly where the corner goes, read off the length
 * it happened to be, then type the right one into the side-lengths panel. That inverts how a site
 * is actually measured — you walk a wall with a tape, write down 12.4 m, and turn the corner. This
 * panel matches that order, so the canvas confirms the measurement instead of originating it.
 *
 * The turn is relative to the previous side, which is the same reference `nextDrawPoint` snaps to.
 * An absolute compass bearing would need a north that the plan does not carry yet, and "turn 90°
 * right" is what somebody standing in their garden can actually answer.
 */

/** The turns worth one tap. Anything else is typed. */
const QUICK_TURNS = [
  { degrees: 90, label: 'Right' },
  { degrees: 0, label: 'Straight' },
  { degrees: 270, label: 'Left' },
];

export function MeasuredCornerPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const boundaryTool = useBoundaryStore((state) => state.boundaryTool);
  const unit = useBoundaryStore((state) => state.unit);
  const addVertexByMeasurement = useBoundaryStore((state) => state.addVertexByMeasurement);
  const closeShape = useBoundaryStore((state) => state.closeShape);

  const [length, setLength] = useState('');
  const [turn, setTurn] = useState(90);

  // Only while there is a next corner to place, and only in the tool that places them.
  if (draft.closed || boundaryTool !== 'draw') return null;

  const corners = draft.vertices.length;

  if (corners === 0) {
    return (
      <Panel>
        <p data-testid="measured-corner-hint" className="text-[11px] text-garden-muted">
          Click anywhere on the plan to drop the first corner. After that you can type each wall
          length instead of clicking.
        </p>
      </Panel>
    );
  }

  const typed = Number(length);
  const valid = Number.isFinite(typed) && typed > 0;

  function place() {
    if (!valid) return;

    addVertexByMeasurement(fromDisplay(typed, unit), turn);
    // The length is per-wall and the turn usually is not, so only the length is cleared.
    setLength('');
  }

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-garden-muted">Length</span>
        <span className="flex flex-1 items-center gap-1 rounded-md border border-garden-line bg-white px-2 py-1 focus-within:border-garden-green">
          <input
            type="number"
            inputMode="decimal"
            min={0.1}
            step={0.1}
            data-testid="measured-length"
            aria-label="Length of the next wall"
            value={length}
            placeholder={toDisplay(10, unit).toFixed(1)}
            onChange={(event) => setLength(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                place();
              }
            }}
            className="w-full min-w-0 bg-transparent text-sm text-garden-ink focus-visible:outline-none"
          />
          <span className="shrink-0 text-[11px] text-garden-muted">{unit}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-garden-muted">Turn</span>
        <div className="flex flex-1 gap-1">
          {QUICK_TURNS.map((option) => (
            <button
              key={option.degrees}
              type="button"
              data-testid={`turn-${option.degrees}`}
              aria-pressed={turn === option.degrees}
              onClick={() => setTurn(option.degrees)}
              className={[
                'flex-1 rounded-md border px-1 py-1 text-[10px] font-medium transition-colors',
                turn === option.degrees
                  ? 'border-garden-green bg-garden-sage text-garden-forest'
                  : 'border-garden-line bg-white text-garden-muted hover:border-garden-green',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        data-testid="add-measured-corner"
        disabled={!valid}
        onClick={place}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-garden-forest px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-garden-green"
      >
        <CornerDownRight aria-hidden className="h-4 w-4" />
        Add corner
      </button>

      {corners >= 3 ? (
        <p className="text-[11px] text-garden-muted">
          {`${corners} corners so far, ${formatLength(perimeter(draft.vertices), unit)} of boundary. `}
          <button
            type="button"
            data-testid="close-shape-panel"
            onClick={closeShape}
            className="font-medium text-garden-green underline underline-offset-2 hover:text-garden-forest"
          >
            Close the boundary
          </button>
        </p>
      ) : null}
    </Panel>
  );
}

/** Walked, not enclosed: the run drawn so far, without the edge that would close it. */
function perimeter(vertices: { x: number; y: number }[]): number {
  let total = 0;

  for (let i = 1; i < vertices.length; i += 1) {
    const from = vertices[i - 1]!;
    const to = vertices[i]!;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }

  return total;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="measured-corner" className="space-y-2 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">Type the next wall</h2>
      {children}
    </section>
  );
}
