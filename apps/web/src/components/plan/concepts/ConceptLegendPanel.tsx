'use client';

import { COLOUR } from '@/lib/canvas-colours';
import { CATEGORY_COLOURS, CATEGORY_ORDER } from '@/lib/concept-colours';

/**
 * Step 2's legend, extended with the surface categories a generated plan introduces.
 *
 * Existing Feature and Boundary are carried over rather than dropped, because a concept still
 * draws both: a feature the user kept appears in its step-2 colours, and the fence is still the
 * fence. Losing those two rows would make the one thing on the plan the user placed themselves
 * the one thing the legend could not explain.
 */
export function ConceptLegendPanel() {
  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Legend</h2>

      <ul data-testid="legend-categories" className="mt-3 space-y-1.5">
        {CATEGORY_ORDER.map((category) => {
          const style = CATEGORY_COLOURS[category];

          return (
            <li key={category} className="flex items-center gap-2.5">
              <span
                aria-hidden
                style={{ background: style.fill, borderColor: style.stroke }}
                className="h-3.5 w-5 shrink-0 rounded-sm border"
              />
              <span className="text-[11px] text-garden-muted">{style.label}</span>
            </li>
          );
        })}
      </ul>

      <ul
        data-testid="legend-context"
        className="mt-3 space-y-1.5 border-t border-garden-line pt-3"
      >
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="flex w-5 shrink-0 justify-center">
            <span
              style={{ background: COLOUR.houseFill, borderColor: COLOUR.houseStroke }}
              className="h-3.5 w-5 rounded-sm border"
            />
          </span>
          <span className="text-[11px] text-garden-muted">House footprint</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden
            style={{ background: COLOUR.stroke }}
            className="h-0.5 w-5 shrink-0 rounded-full"
          />
          <span className="text-[11px] text-garden-muted">Property boundary</span>
        </li>
      </ul>
    </section>
  );
}
