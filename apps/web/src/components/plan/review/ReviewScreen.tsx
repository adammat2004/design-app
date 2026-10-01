'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ClipboardCheck, X } from 'lucide-react';
import {
  BUDGET_LABELS,
  estimateBudgetBand,
  groundCoverArea,
  housePolygon,
  issuesBySeverity,
  layoutFingerprint,
  planTakeoff,
  type BudgetBand,
  type GeneratedConcept,
} from '@garden-studio/schema';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { useBriefStore } from '@/state/brief-store';
import { chosenConcept, useConceptsStore } from '@/state/concepts-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { DownloadPlanButton } from '../DownloadPlanButton';
import { GardenPreviewLoader } from '../../garden-3d/GardenPreviewLoader';
import { ViewInThreeDButton } from '../../garden-3d/ViewInThreeDButton';
import { useGardenPreviewStore } from '@/state/garden-preview-store';
import { PlanTopBar } from '../PlanTopBar';
import { usePlanHref } from '../ProjectContext';
import { ScheduleTable } from './ScheduleTable';
import { TakeoffTable } from './TakeoffTable';

/**
 * Step 6, at last.
 *
 * This was a signpost card reading "Review is coming" — the last screen in the wizard, and the one
 * a marker reaches after walking the whole thing, so the demo ended on an admission of
 * incompleteness. It reads real plan data now.
 *
 * Everything on it is **derived, never stored**: the schedule from `planSchedule`, the lengths and
 * counts from `planTakeoff`, the area from `groundCoverArea`, the cost band from `estimateBudgetBand`. There is no "review" section on the
 * document and there should not be, for the same reason zones are recomputed rather than saved — a
 * summary that can disagree with the thing it summarises is worse than no summary.
 */
export function ReviewScreen() {
  const planHref = usePlanHref();

  const elements = usePlanEditorStore((state) => state.present.elements);
  const unit = useBoundaryStore((state) => state.unit);
  /* Edging against the fence or the house is not laid, so it must not be ordered. */
  const boundary = useBoundaryStore((state) => state.present.vertices);
  const house = useBoundaryStore((state) => state.present.house);
  const projectName = useBoundaryStore((state) => state.projectName);
  const brief = useBriefStore((state) => state.present);
  const concept = useConceptsStore(chosenConcept);
  const previewOpen = useGardenPreviewStore((state) => state.open);
  // A view state of this screen: leaving it closes the preview, so the next screen does not open on it.
  useEffect(() => () => useGardenPreviewStore.getState().closePreview(), []);

  const site = useBoundaryStore((state) => state.present);
  const pristine = usePlanEditorStore((state) => state.pristine);
  /* Whether the plan is still the concept as generated — the explanation and score describe that one. */
  const edited =
    pristine !== null && layoutFingerprint(pristine) !== layoutFingerprint(elements);
  const hasTakeoff =
    planTakeoff({ elements, site, ...(house ? { house: housePolygon(house) } : {}) }).length > 0;

  const area = groundCoverArea(elements);
  const spec = estimateBudgetBand(elements);
  const asked = brief.budget;

  return (
    <div className="flex min-h-dvh flex-col bg-garden-canvas">
      <PlanTopBar currentStep={6} />
      {/* No structure editor on this screen, so a pergola here is looked at rather than opened. */}
      {previewOpen ? <GardenPreviewLoader /> : null}

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-5">
        <header className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
            <ClipboardCheck aria-hidden className="h-5 w-5 text-garden-green" />
          </span>
          <div>
            <h1 className="text-base font-semibold text-garden-forest">{projectName}</h1>
            <p className="mt-0.5 text-xs text-garden-muted">
              {concept ? `Based on ${concept.name}. ` : ''}
              Everything below is measured off the plan itself.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
            <ViewInThreeDButton variant="primary" disabled={elements.length === 0} />
            <DownloadPlanButton variant="primary" />
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Ground covered"
            value={formatArea(area, unit)}
            testId="review-area"
            note="The designed zones, measured once"
          />
          <Stat
            label="Materials come to"
            value={BUDGET_LABELS[spec]}
            testId="review-spec-band"
            note={budgetNote(asked, spec)}
          />
          <Stat
            label="Budget asked for"
            value={asked ? BUDGET_LABELS[asked] : 'Not set'}
            testId="review-asked-band"
          />
        </div>

        <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold text-garden-forest">Schedule of materials</h2>
          <ScheduleTable
            elements={elements}
            unit={unit}
            boundary={boundary}
            house={house}
          />
          <p className="mt-3 text-[10px] leading-relaxed text-garden-muted">
            Areas are measured from the drawn shapes. Ground cover is the full zone with everything
            else laid over it, so the two groups overlap and should not be added together. Slab and
            board counts come from real product dimensions; planting is drawn at a density chosen to
            read well on a plan, so it is given as an area rather than a number of plants.
          </p>
        </section>

        {hasTakeoff ? (
          <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-xs font-semibold text-garden-forest">Lengths and counts</h2>
            <TakeoffTable elements={elements} site={site} house={house} unit={unit} />
          </section>
        ) : null}

        {concept ? <DesignSummary concept={concept} edited={edited} /> : null}

        {concept && concept.requestedFeaturesIncluded.length > 0 ? (
          <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-xs font-semibold text-garden-forest">What you asked for</h2>
            <ul data-testid="requested-features" className="space-y-1">
              {concept.requestedFeaturesIncluded.map((check) => (
                <li key={check.feature} className="flex items-center gap-2 text-xs">
                  {check.included ? (
                    <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-green" />
                  ) : (
                    <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
                  )}
                  <span className={check.included ? 'text-garden-ink' : 'text-garden-muted'}>
                    {check.label}
                  </span>
                  {!check.included ? (
                    <span className="text-[10px] text-garden-muted">could not be fitted</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Link
          href={planHref('editor')}
          data-testid="back-to-editor"
          className="inline-flex items-center gap-2 rounded-full border border-garden-line bg-white px-4 py-2 text-xs font-semibold text-garden-forest hover:bg-garden-sage"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back to the editor
        </Link>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string | null;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-garden-line bg-white p-3 shadow-sm">
      <p className="text-[10px] font-semibold tracking-wide text-garden-muted uppercase">{label}</p>
      <p data-testid={testId} className="mt-0.5 text-sm font-semibold text-garden-ink">
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[10px] text-garden-muted">{note}</p> : null}
    </div>
  );
}

/**
 * Whether the spec landed where the brief aimed.
 *
 * Said in the same four words the user picked from on step 3, which is what makes this checkable
 * rather than decorative — and why neither number is ever expressed in pounds.
 */
function budgetNote(asked: BudgetBand | null, spec: BudgetBand): string | null {
  if (!asked) return null;

  const order: BudgetBand[] = ['low', 'medium', 'high', 'premium'];
  const difference = order.indexOf(spec) - order.indexOf(asked);

  if (difference === 0) return 'Matches the brief';
  return difference > 0 ? 'Above the brief' : 'Below the brief';
}

/**
 * Why the design is the way it is, carried over from step 4 — the one place a marker or a client
 * reads the whole of it.
 *
 * The explanation and the score describe the concept **as generated**, and the plan may have been
 * edited since; a score shown as though it were about the edited garden would be a number about a
 * plan nobody is looking at. So it says which it is, from the same fingerprint that tells a reloaded
 * session whether a redesign is still undoable.
 */
function DesignSummary({ concept, edited }: { concept: GeneratedConcept; edited: boolean }) {
  const decisions = concept.explanation?.decisions ?? [];
  const score = concept.score;
  if (decisions.length === 0 && !score) return null;

  const faults = score
    ? issuesBySeverity(score)
        .filter((issue) => issue.severity !== 'minor')
        .slice(0, 3)
    : [];

  return (
    <section
      data-testid="design-summary"
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold text-garden-forest">Why this design</h2>
        {score ? (
          <span data-testid="design-score" className="ml-auto text-[11px] text-garden-muted">
            Design score {Math.round(score.total * 100)} / 100
            {edited ? ' when generated' : ''}
          </span>
        ) : null}
      </div>

      {decisions.length > 0 ? (
        <ul className="space-y-1.5">
          {decisions.map((decision, index) => (
            <li
              key={`${decision.kind}-${index}`}
              className="flex gap-2 text-[11px] leading-relaxed text-garden-ink"
            >
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-garden-green" />
              {decision.text}
            </li>
          ))}
        </ul>
      ) : null}

      {faults.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-[11px] font-semibold text-garden-ink">Worth another look</h3>
          <ul className="mt-1 space-y-1">
            {faults.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="text-[11px] leading-relaxed text-garden-muted">
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {edited ? (
        <p className="mt-3 text-[10px] leading-relaxed text-garden-muted">
          You have edited the plan since it was generated, so this describes the concept you started
          from. Ask the designer to review it from the editor for a reading of the plan as it is now.
        </p>
      ) : null}
    </section>
  );
}
