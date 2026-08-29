'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { usePlanHref } from '../ProjectContext';
import { PLAN_STEPS } from '../StepIndicator';

/**
 * The wizard's four steps with a line of explanation each — the top indicator, unabbreviated.
 * It is a second view of the same `PLAN_STEPS`, never a second source, so the two cannot
 * disagree about what step three is called.
 *
 * The descriptions live here rather than on `PLAN_STEPS` because this is their only consumer;
 * the top bar has no room for them.
 */
const DESCRIPTIONS: Record<number, string> = {
  1: 'Boundary & house',
  2: "Mark what's already there",
  3: 'Tell us what you want',
  4: 'Generate & explore',
};

export function BriefProgress({ current }: { current: number }) {
  const planHref = usePlanHref();

  return (
    <ol data-testid="brief-progress" className="space-y-2">
      {PLAN_STEPS.map((step) => {
        const state =
          step.number < current ? 'done' : step.number === current ? 'current' : 'upcoming';

        const body = (
          <>
            <span
              className={[
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                state === 'upcoming'
                  ? 'border border-garden-line bg-white text-garden-muted'
                  : 'bg-garden-green text-white',
              ].join(' ')}
            >
              {state === 'done' ? <Check aria-hidden className="h-3.5 w-3.5" /> : step.number}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-garden-ink">{step.label}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">
                {DESCRIPTIONS[step.number]}
              </span>
            </span>
          </>
        );

        const shell = [
          'flex w-full items-start gap-3 rounded-xl border p-3 text-left',
          state === 'current'
            ? 'border-garden-green bg-garden-sage/50'
            : state === 'upcoming'
              ? 'border-garden-line bg-white opacity-60'
              : 'border-garden-line bg-white hover:border-garden-green hover:bg-garden-sage/40',
        ].join(' ');

        return (
          <li key={step.number}>
            {/* Finished steps are a way back; the current one and the unbuilt one are not links. */}
            {state === 'done' ? (
              <Link
                href={planHref(step.step)}
                data-testid={`progress-step-${step.number}`}
                data-state={state}
                className={shell}
              >
                {body}
              </Link>
            ) : (
              <div
                data-testid={`progress-step-${step.number}`}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className={shell}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
