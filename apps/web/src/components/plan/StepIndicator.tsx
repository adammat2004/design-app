import { Check } from 'lucide-react';

/**
 * The guided flow is six steps. Step 6 is a placeholder — review is not built yet — so it leads
 * to a "coming soon" page rather than to the review screen.
 *
 * Each entry carries a `step` slug rather than a finished href, because every wizard URL is
 * scoped to a project (`/plan/<id>/map`). One list of slugs plus one `planHref` is what keeps
 * the indicator, the brief's progress panel and the bottom bar from each assembling their own
 * URLs and disagreeing.
 *
 * Nothing in this component is a link. The wizard is navigated by Continue and by the explicit
 * back-links on each screen, which is what makes listing a step that does not do anything yet
 * safe: it cannot be reached by clicking it.
 */
export const PLAN_STEPS = [
  { number: 1, label: 'Map dimensions', step: 'map' },
  { number: 2, label: 'Existing features', step: 'features' },
  { number: 3, label: 'Your vision', step: 'brief' },
  { number: 4, label: 'Design concepts', step: 'concepts' },
  { number: 5, label: 'Editor', step: 'editor' },
  { number: 6, label: 'Review', step: 'review' },
] as const;

export function StepIndicator({ current }: { current: number }) {
  return (
    <ol
      data-testid="plan-step-indicator"
      aria-label="Design steps"
      className="flex items-center gap-1 sm:gap-2"
    >
      {PLAN_STEPS.map((step, index) => {
        const state =
          step.number < current ? 'done' : step.number === current ? 'current' : 'upcoming';

        return (
          <li key={step.number} className="flex items-center gap-1 sm:gap-2">
            <div
              data-testid={`plan-step-${step.number}`}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'upcoming'
                    ? 'border border-garden-line bg-white text-garden-muted'
                    : 'bg-garden-green text-white',
                ].join(' ')}
              >
                {state === 'done' ? <Check aria-hidden className="h-3.5 w-3.5" /> : step.number}
              </span>
              <span
                className={[
                  'hidden text-xs font-medium whitespace-nowrap md:inline',
                  state === 'current' ? 'text-garden-green' : 'text-garden-muted',
                ].join(' ')}
              >
                {step.label}
              </span>
              <span className="sr-only md:hidden">{step.label}</span>
            </div>

            {/* Narrower than they would be for three steps: four labels plus three connectors
                have to share the top bar with the logo and the avatar cluster. */}
            {index < PLAN_STEPS.length - 1 ? (
              <span aria-hidden className="h-px w-4 bg-garden-line sm:w-6 lg:w-10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
