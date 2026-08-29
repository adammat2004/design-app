'use client';

import { Sparkles } from 'lucide-react';
import { briefBlockedReason, briefCompletion } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { PlanBottomBar } from '../PlanBottomBar';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { FeatureLegendPanel } from '../features/FeatureLegendPanel';
import { BriefProgress } from './BriefProgress';
import { BudgetPicker } from './BudgetPicker';
import { ContextPanel } from './ContextPanel';
import { DesiredFeaturesGrid } from './DesiredFeaturesGrid';
import { FormSection } from './FormSection';
import { InspirationCallout } from './InspirationCallout';
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
     * Unlike steps 1 and 2 this is `min-h-dvh` rather than `h-dvh` with the columns scrolling
     * inside themselves. That pattern exists to keep the canvas chrome — compass, scale bar,
     * zoom stack — above the fold; there is no canvas here, and a form that scrolls the page
     * is what a form should do.
     */
    <div className="flex min-h-dvh flex-col">
      <PlanTopBar currentStep={3} />

      <div className="flex flex-1 flex-col gap-4 p-4 xl:flex-row xl:gap-5 xl:p-5">
        <aside className="space-y-4 rounded-xl border border-garden-line bg-white p-4 shadow-sm xl:w-72 xl:shrink-0 xl:self-start">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Sparkles aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Your vision</h1>
              <p className="mt-1 text-xs leading-relaxed text-garden-muted">
                Tell us how you want to use the space and the look you are after, so the concepts
                come back close to what you had in mind.
              </p>
            </div>
          </div>

          <BriefProgress current={3} />
          <ContextPanel />
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <FormSection
            id="purpose"
            number={1}
            title="What's this space for?"
            hint="optional but encouraged"
            description="Tell us in your own words — how you want this space to feel and function."
            done={done('purpose')}
          >
            <PurposeField />
          </FormSection>

          <FormSection
            id="features"
            number={2}
            title="What would you like in your new space?"
            hint="select all that apply"
            done={done('features')}
          >
            <DesiredFeaturesGrid />
          </FormSection>

          {/*
            Two up on wide viewports. `xl` rather than `lg`, because this column is at its
            narrowest exactly when the two side columns appear — below `xl` the columns stack
            and the form runs full width, so an `lg` split would divide it at the wrong moment.
          */}
          <div className="grid gap-4 xl:grid-cols-2">
            <FormSection
              id="budget"
              number={3}
              title="Budget"
              hint="choose a band"
              helper="This helps us tailor materials and complexity."
              done={done('budget')}
            >
              <BudgetPicker />
            </FormSection>

            <FormSection
              id="maintenance"
              number={4}
              title="Maintenance preference"
              helper="This guides planting choices and layout balance."
              done={done('maintenance')}
            >
              <MaintenancePicker />
            </FormSection>
          </div>

          <FormSection
            id="style"
            number={5}
            title="Style direction"
            hint="choose one"
            helper="This sets the overall look and feel of your designs."
            done={done('style')}
          >
            <StylePicker />
          </FormSection>
        </main>

        <aside className="space-y-4 xl:w-64 xl:shrink-0 xl:self-start">
          <InspirationCallout />
          {/* The step 2 legend verbatim — read-only reference, not a second vocabulary. */}
          <FeatureLegendPanel />
        </aside>
      </div>

      {/*
        Budget, maintenance and style are required; the purpose text and both "Other" boxes are
        not. `briefBlockedReason` owns that rule and names what is still missing.
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
