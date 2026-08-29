'use client';

import { Check } from 'lucide-react';
import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * Progress *within* step 1: draw the plot, then put the house in it. Distinct from the
 * three-step indicator in the top bar, which tracks the wizard as a whole.
 */
export function SubStepChecklist() {
  const draft = useBoundaryStore((state) => state.present);
  const mode = useBoundaryStore((state) => state.mode);
  const unit = useBoundaryStore((state) => state.unit);
  const setMode = useBoundaryStore((state) => state.setMode);

  const totalArea = polygonArea(draftPolygon(draft));
  const houseDone = draft.house !== null;

  return (
    <ol data-testid="sub-steps" className="space-y-2">
      <SubStep
        number={1}
        testId="sub-step-boundary"
        title="Property boundary"
        detail={
          draft.closed
            ? `${draft.vertices.length} points · ${formatArea(totalArea, unit)}`
            : draft.vertices.length > 0
              ? `${draft.vertices.length} points · not closed yet`
              : 'Click the corners of your property'
        }
        done={draft.closed}
        active={mode === 'boundary'}
        onClick={() => setMode('boundary')}
      />
      <SubStep
        number={2}
        testId="sub-step-house"
        title="House footprint"
        detail={
          houseDone ? 'Placed — drag or resize to adjust' : 'Place your house inside the property'
        }
        done={houseDone}
        active={mode === 'house'}
        disabled={!draft.closed}
        onClick={() => setMode('house')}
      />
    </ol>
  );
}

function SubStep({
  number,
  testId,
  title,
  detail,
  done,
  active,
  disabled,
  onClick,
}: {
  number: number;
  testId: string;
  title: string;
  detail: string;
  done: boolean;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-testid={testId}
        data-done={done}
        aria-current={active ? 'step' : undefined}
        disabled={disabled}
        onClick={onClick}
        className={[
          'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
          'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'border-garden-green bg-garden-sage/50' : 'border-garden-line bg-white',
        ].join(' ')}
      >
        <span
          className={[
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
            done ? 'bg-garden-green text-white' : 'bg-garden-forest text-white',
          ].join(' ')}
        >
          {done ? <Check aria-hidden className="h-3.5 w-3.5" /> : number}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-garden-ink">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">
            {detail}
          </span>
        </span>
      </button>
    </li>
  );
}
