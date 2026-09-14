'use client';

import Link from 'next/link';
import { Check, CircleCheck, CircleX, PenLine, Star } from 'lucide-react';
import { BUDGET_BANDS, MAINTENANCE_LEVELS } from '@/lib/brief';
import type { GeneratedConcept } from '@/lib/concepts';
import { useConceptsStore } from '@/state/concepts-store';
import { usePlanHref } from '../ProjectContext';
import { DesiredFeatureIcon } from '../brief/BriefIcons';
import { AccentDot } from './ConceptPills';

/**
 * The right column: what the selected concept actually is, and the two ways out of this screen.
 *
 * Every value here is read off the concept object. In particular the "Requested features
 * included" list walks `requestedFeaturesIncluded`, which the generator writes as it succeeds
 * or fails to fit each thing — so a cross appears when a feature genuinely did not fit, rather
 * than every row showing a tick because the mockup did.
 */
export function ConceptDetailsPanel({ concept }: { concept: GeneratedConcept | null }) {
  const planHref = usePlanHref();
  const chosenConceptId = useConceptsStore((state) => state.chosenConceptId);
  const choose = useConceptsStore((state) => state.choose);

  if (!concept) {
    return (
      <section
        data-testid="concept-details"
        className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
      >
        <h2 className="text-xs font-semibold text-garden-ink">Concept details</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-garden-muted">
          Pick a concept on the left to see what it includes.
        </p>
      </section>
    );
  }

  const chosen = concept.id === chosenConceptId;
  const budget = BUDGET_BANDS.find((band) => band.id === concept.budget);
  const maintenance = MAINTENANCE_LEVELS.find((level) => level.id === concept.maintenance);
  const decisions = concept.explanation?.decisions ?? [];
  const repairs = concept.explanation?.repairs ?? [];
  /* Only the ones that carry a reason: a cross with nothing after it is the list above already. */
  const excluded = concept.requestedFeaturesIncluded.filter(
    (check): check is typeof check & { reason: string } => !check.included && Boolean(check.reason),
  );

  return (
    <section
      data-testid="concept-details"
      data-concept={concept.id}
      className="space-y-3 rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="text-xs font-semibold text-garden-ink">Concept details</h2>

      <div className="rounded-lg border border-garden-line bg-garden-sage/30 p-3">
        <div className="flex items-start justify-between gap-2">
          <p data-testid="details-name" className="text-sm font-semibold text-garden-forest">
            {concept.name}
          </p>
          {concept.recommended ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-garden-green px-1.5 py-px text-[9px] font-semibold text-garden-green">
              <Star aria-hidden className="h-2.5 w-2.5" />
              Recommended
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-garden-muted">{concept.summary}</p>

        <dl className="mt-3 space-y-1.5 border-t border-garden-line pt-2.5">
          <MetaRow label="Style" value={concept.style} testId="details-style" />
          <MetaRow
            label="Budget"
            value={budget?.label ?? concept.budget}
            accent={budget?.accent}
            testId="details-budget"
          />
          <MetaRow
            label="Maintenance"
            value={maintenance?.label ?? concept.maintenance}
            accent={maintenance?.accent}
            testId="details-maintenance"
          />
          {/*
            What the materials actually came to, next to what the concept was aiming at. Two rows
            rather than one, because they answer different questions — "how expensive is this
            meant to be" and "how expensive did it turn out" — and a concept that missed is worth
            being able to see. Absent on plans generated before the field existed.
          */}
          {concept.estimatedBudget ? (
            <MetaRow
              label="Materials"
              value={
                BUDGET_BANDS.find((band) => band.id === concept.estimatedBudget)?.label ??
                concept.estimatedBudget
              }
              accent={BUDGET_BANDS.find((band) => band.id === concept.estimatedBudget)?.accent}
              testId="details-materials"
            />
          ) : null}
        </dl>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold text-garden-ink">Requested features included</h3>

        {concept.requestedFeaturesIncluded.length === 0 ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-garden-muted">
            You did not ask for any specific features, so this concept is planting and surfaces
            only.
          </p>
        ) : (
          <ul data-testid="requested-features" className="mt-1.5 space-y-1">
            {concept.requestedFeaturesIncluded.map((check) => (
              <li
                key={check.feature}
                data-testid={`requested-${check.feature}`}
                data-included={check.included}
                className="flex items-center gap-2 text-[11px] text-garden-ink"
              >
                <DesiredFeatureIcon
                  id={check.feature}
                  className="h-3.5 w-3.5 shrink-0 text-garden-muted"
                />
                <span className={check.included ? '' : 'text-garden-muted line-through'}>
                  {check.label}
                </span>
                {check.included ? (
                  <CircleCheck
                    aria-label="Included"
                    className="ml-auto h-3.5 w-3.5 text-garden-green"
                  />
                ) : (
                  <CircleX
                    aria-label="Did not fit"
                    className="ml-auto h-3.5 w-3.5 text-garden-muted"
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {/*
          Why a feature was left out, where the design agent had a reason for it. "The pond is
          missing" and "there was no room for the pond without losing the lawn" are different
          answers and only the second is a design decision — which is the entire argument for
          letting a concept exclude something in the first place.
        */}
        {excluded.length > 0 ? (
          <ul data-testid="excluded-reasons" className="mt-2 space-y-1.5">
            {excluded.map((check) => (
              <li
                key={check.feature}
                className="border-l-2 border-garden-line pl-2 text-[10px] leading-relaxed text-garden-muted"
              >
                <span className="font-medium text-garden-ink">{check.label}:</span> {check.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/*
        What the concept decided and why.

        Absent on any plan generated before the design agent existed, which is most of the reason
        this is a conditional block rather than a section with an empty state: a concept with no
        explanation is an older concept, not a concept that failed to explain itself.
      */}
      {decisions.length > 0 ? (
        <div>
          <h3 className="text-[11px] font-semibold text-garden-ink">Why this design</h3>
          <ul data-testid="design-decisions" className="mt-1.5 space-y-1.5">
            {decisions.map((decision, index) => (
              <li
                key={`${decision.kind}-${index}`}
                data-testid={`decision-${decision.kind}`}
                className="flex gap-2 text-[11px] leading-relaxed text-garden-ink"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-garden-green"
                />
                {decision.text}
              </li>
            ))}
          </ul>
          {concept.explanation?.rationale ? (
            <p className="mt-2 text-[10px] leading-relaxed text-garden-muted">
              {concept.explanation.rationale}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        What the design agent changed after it had drawn the plan and looked at it.

        Its own heading rather than more bullets under "Why this design", because these are a
        different kind of claim: a decision says what the concept did, a repair says what it did
        *instead*, and each one was accepted only because the score measurably rose afterwards.
        Most concepts need none and show nothing.
      */}
      {repairs.length > 0 ? (
        <div>
          <h3 className="text-[11px] font-semibold text-garden-ink">What was adjusted</h3>
          <ul data-testid="design-repairs" className="mt-1.5 space-y-1.5">
            {repairs.map((repair, index) => (
              <li
                key={`repair-${index}`}
                className="flex gap-2 text-[11px] leading-relaxed text-garden-ink"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-garden-muted"
                />
                {repair}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-garden-line pt-3">
        <button
          type="button"
          data-testid="choose-concept"
          onClick={() => choose(concept.id)}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white',
            chosen ? 'bg-garden-green' : 'bg-garden-forest hover:bg-garden-green',
          ].join(' ')}
        >
          <Check aria-hidden className="h-4 w-4" />
          {chosen ? 'Chosen' : 'Choose this concept'}
        </button>

        <Link
          href={planHref('editor')}
          data-testid="edit-concept"
          /* Editing implies choosing — you cannot adjust a concept you have not taken. */
          onClick={() => choose(concept.id)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-garden-line px-4 py-2 text-sm font-medium text-garden-ink hover:bg-garden-sage"
        >
          <PenLine aria-hidden className="h-4 w-4" />
          Edit concept
        </Link>

        <p className="text-[10px] leading-relaxed text-garden-muted">
          Choosing locks this concept in and unlocks Continue. Editing does the same and takes you
          straight to the editor.
        </p>
      </div>
    </section>
  );
}

function MetaRow({
  label,
  value,
  accent,
  testId,
}: {
  label: string;
  value: string;
  accent?: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <dt className="text-garden-muted">{label}</dt>
      <dd data-testid={testId} className="flex items-center gap-1.5 font-medium text-garden-ink">
        {accent ? <AccentDot colour={accent} /> : null}
        {value}
      </dd>
    </div>
  );
}
