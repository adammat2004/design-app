'use client';

import { briefBlockedReason, briefCompletion } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { BudgetPicker } from './BudgetPicker';
import { ContextPanel } from './ContextPanel';
import { DesiredFeaturesGrid } from './DesiredFeaturesGrid';
import { FormSection } from './FormSection';
import { MaintenancePicker } from './MaintenancePicker';
import { PurposeField } from './PurposeField';
import { StylePicker } from './StylePicker';

export function BriefScreen() {
  const planHref = usePlanHref();
  const brief = useBriefStore((state) => state.present);

  const completion = briefCompletion(brief);
  const done = (id: string) =>
    completion.sections.find((section) => section.id === id)?.done ?? false;

  return (
    /*
     * `min-h-dvh` with the page scrolling, not `h-dvh` with columns scrolling inside themselves.
     * That pattern exists to keep the canvas chrome — compass, scale bar, zoom stack — above the
     * fold; there is no canvas here.
     *
     * **One centred column, and no side rails.** The three panels that used to flank this form are
     * gone rather than moved: `BriefProgress` restated the step indicator already in the top bar,
     * and `FeatureLegendPanel` was step 2's vocabulary for features that already *exist*, which on
     * a screen about what you *want* is a second and conflicting legend. What survives is
     * `ContextPanel`, restyled as a strip under the heading, because it is the only one that
     * answers a question the user genuinely has here — which part of the property am I briefing.
     *
     * This is also what the imagery needs. Sixteen photographs four across want the whole width of
     * the page; squeezed into a middle column between two rails they land at the size the icons
     * they replaced were, and the redesign buys nothing.
     */
    <div className="flex min-h-dvh flex-col">
      <PlanTopBar currentStep={3} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        {/*
         * The one place in the wizard that breaks the all-small type scale, deliberately. Every
         * other screen is a tool with its controls labelled at `text-xs`; this one is a question,
         * it is asked once, and a question set in the same size as a tooltip reads as a form field.
         */}
        <header>
          <h1 className="text-2xl leading-tight font-semibold text-garden-forest sm:text-3xl">
            What would you like to add to your garden?
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-garden-muted">
            Choose the spaces and features you&rsquo;d like us to include. Select as many as you
            like &mdash; we&rsquo;ll work out how they fit together.
          </p>
        </header>

        <div className="mt-5">
          <ContextPanel />
        </div>

        <section
          data-testid="brief-section-features"
          data-done={done('features')}
          className="mt-6 sm:mt-8"
        >
          <DesiredFeaturesGrid />
        </section>

        {/* A rule rather than a card edge: the two questions are peers, not two panels. */}
        <hr className="mt-10 border-garden-line sm:mt-12" />

        <section
          data-testid="brief-section-style"
          data-done={done('style')}
          className="mt-8 sm:mt-10"
        >
          <h2 className="text-xl leading-tight font-semibold text-garden-forest sm:text-2xl">
            What would you like your garden to look like?
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-garden-muted">
            Choose a look and feel to guide your garden design. You can customise this further
            later.
          </p>

          <div className="mt-5">
            <StylePicker />
          </div>
        </section>

        <hr className="mt-10 border-garden-line sm:mt-12" />

        {/*
         * ---- the rest of the brief, deliberately quieter ----
         *
         * Budget and maintenance are the two answers that actually gate Continue, and they are at
         * the bottom in small cards — which looks backwards and is not. The pictures above are
         * where the user forms an opinion; these are two clicks they will make in a second once
         * they have. Putting them first would open the screen on a form and lose the whole point
         * of it, and the bottom bar names anything still outstanding, so nothing can be missed by
         * scrolling past it.
         *
         * The numbered `FormSection` framing survives only here, which is the honest division: the
         * two questions above are a brief, and these three are fields.
         */}
        <section className="mt-8 sm:mt-10">
          <h2 className="text-base font-semibold text-garden-forest">A few more details</h2>
          <p className="mt-1.5 text-sm text-garden-muted">
            These shape the materials and the planting we choose.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <FormSection
              id="budget"
              number={1}
              title="Budget"
              hint="choose a band"
              helper="This helps us tailor materials and complexity."
              done={done('budget')}
            >
              <BudgetPicker />
            </FormSection>

            <FormSection
              id="maintenance"
              number={2}
              title="Maintenance preference"
              helper="This guides planting choices and layout balance."
              done={done('maintenance')}
            >
              <MaintenancePicker />
            </FormSection>
          </div>

          <div className="mt-4">
            <FormSection
              id="purpose"
              number={3}
              title="Anything else we should know?"
              hint="optional"
              description="Tell us in your own words how you want the space to feel and function."
              done={done('purpose')}
            >
              <PurposeField />
            </FormSection>
          </div>
        </section>
      </main>

      {/*
        Budget, maintenance and style are required; the purpose text, the spaces and both "Other"
        boxes are not. `briefBlockedReason` owns that rule and names what is still missing.
      */}
      <PlanBottomBar
        continueHref={planHref('concepts')}
        continueLabel="Next: Generate concepts"
        caption="You can refine these later."
        blockedReason={briefBlockedReason(brief)}
      />
    </div>
  );
}
