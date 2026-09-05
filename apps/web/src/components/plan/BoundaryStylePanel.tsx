'use client';

import { boundaryRuns, type BoundaryKind } from '@garden-studio/schema';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * What each side of the property is made of.
 *
 * Sits with step 1's other site questions, beside `AccessPanel`, and follows the same rules it
 * does. It is **never inferred**: a fence is the documented default because it is what most
 * suburban plots have, and a tap is how the user says otherwise. Nothing here gates Continue —
 * a plan whose sides are all left as fences is a perfectly ordinary plan.
 *
 * Sides are listed rather than drawn, and identified by their compass-free description ("18.0 m
 * side") plus a highlight on the plan when the row is hovered. Naming them "north" or "left" would
 * both be wrong: the plot can be drawn at any angle and the canvas can be panned, so the only
 * honest identity a side has is its own length and its position in the outline.
 */

const KINDS: { id: BoundaryKind; label: string; hint: string }[] = [
  { id: 'fence', label: 'Fence', hint: 'Close-boarded timber panels' },
  { id: 'wall', label: 'Wall', hint: 'Brick or block, about 1.8 m' },
  { id: 'hedge', label: 'Hedge', hint: 'Takes about 0.7 m of the garden' },
  { id: 'railing', label: 'Railing', hint: 'You can see through it' },
  { id: 'open', label: 'Open', hint: 'Nothing built on this side' },
];

export function BoundaryStylePanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const setBoundaryKind = useBoundaryStore((state) => state.setBoundaryKind);

  // Only once the plot is a plot. A half-drawn outline has edges but not yet sides.
  if (!draft.closed || draft.vertices.length < 3) return null;

  const runs = boundaryRuns(draft);
  if (runs.length === 0) return null;

  return (
    <section data-testid="boundary-style-panel" className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-garden-ink">Boundaries</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
          What encloses each side. A hedge takes real space, and a wall throws a longer shadow.
        </p>
      </div>

      <ul className="space-y-2">
        {runs.map((run, index) => (
          <li key={run.edgeVertexId} className="rounded-lg border border-garden-line p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-garden-ink">Side {index + 1}</span>
              <span className="text-[11px] text-garden-muted">
                {formatLength(run.length, unit)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {KINDS.map((kind) => {
                const active = run.kind === kind.id;

                return (
                  <button
                    key={kind.id}
                    type="button"
                    data-testid={`boundary-kind-${index}-${kind.id}`}
                    title={kind.hint}
                    aria-pressed={active}
                    onClick={() => setBoundaryKind(run.edgeVertexId, kind.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? 'bg-garden-forest text-white'
                        : 'bg-garden-sage text-garden-forest hover:bg-garden-green hover:text-white'
                    }`}
                  >
                    {kind.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
