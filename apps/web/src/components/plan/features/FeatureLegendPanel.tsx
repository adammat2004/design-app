'use client';

import { STATUS_COLOURS, STATUS_ORDER } from '@/lib/feature-colours';
import { FEATURE_DEFINITIONS, FEATURE_KINDS } from '@/lib/features';
import { FeatureIcon } from './FeatureIcon';

/**
 * Two vocabularies in one card: what each icon means, and what each outline colour means. They
 * are separated because they answer different questions — "what is that shape" and "what is
 * happening to it".
 */
export function FeatureLegendPanel() {
  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Legend</h2>

      <ul data-testid="legend-types" className="mt-3 space-y-1.5">
        {FEATURE_KINDS.map((kind) => (
          <li key={kind} className="flex items-center gap-2.5">
            <FeatureIcon kind={kind} className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
            <span className="text-[11px] text-garden-muted">{FEATURE_DEFINITIONS[kind].label}</span>
          </li>
        ))}
      </ul>

      <ul
        data-testid="legend-statuses"
        className="mt-3 space-y-1.5 border-t border-garden-line pt-3"
      >
        {STATUS_ORDER.map((status) => {
          const style = STATUS_COLOURS[status];

          return (
            <li key={status} className="flex items-center gap-2.5">
              <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 overflow-visible">
                  <rect
                    x="1"
                    y="1"
                    width="12"
                    height="12"
                    rx="3"
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth="1.5"
                    strokeDasharray={style.dash?.join(' ')}
                  />
                </svg>
              </span>
              <span className="text-[11px] text-garden-muted">{style.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
