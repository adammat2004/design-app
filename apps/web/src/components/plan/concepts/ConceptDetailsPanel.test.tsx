import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratedConcept } from '@/lib/concepts';
import { ConceptDetailsPanel } from './ConceptDetailsPanel';

/**
 * The panel reads what the design agent wrote, and says nothing when it wrote nothing.
 *
 * The second half matters as much as the first: every concept generated before the agent existed
 * has no `explanation` and no per-feature reasons, and those are stored in documents people already
 * have. A panel that rendered an empty "Why this design" heading over them would make an older plan
 * look broken rather than older.
 */

vi.mock('../ProjectContext', () => ({ usePlanHref: () => () => '/plan/1/editor' }));
vi.mock('@/state/concepts-store', () => ({
  useConceptsStore: (selector: (state: unknown) => unknown) =>
    selector({ chosenConceptId: null, choose: () => {} }),
}));

function concept(over: Partial<GeneratedConcept> = {}): GeneratedConcept {
  return {
    id: 'c1-0',
    name: 'Terrace and lawn',
    recommended: true,
    summary: 'A terrace across the doors.',
    style: 'Modern / Structured',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [],
    elements: [],
    ...over,
  } as GeneratedConcept;
}

describe('the concept details panel', () => {
  it('lists the decisions the concept took', () => {
    render(
      <ConceptDetailsPanel
        concept={concept({
          explanation: {
            strategy: 'terrace_and_lawn',
            briefId: 'A',
            intent: 'entertaining',
            emphasis: 'social',
            rationale: 'A garden built round eating outside.',
            decisions: [
              {
                kind: 'terrace-at-doors',
                text: 'Put the main terrace directly outside the garden doors.',
                subjects: ['e1'],
              },
              { kind: 'shed-by-gate', text: 'Kept the store by the side gate.', subjects: ['e2'] },
            ],
            excludedFeatures: [],
            repairs: [],
          },
        })}
      />,
    );

    expect(screen.getByTestId('design-decisions').children).toHaveLength(2);
    expect(screen.getByTestId('decision-terrace-at-doors')).toHaveTextContent(
      'Put the main terrace directly outside the garden doors.',
    );
    expect(screen.getByText('A garden built round eating outside.')).toBeTruthy();
  });

  it('says why a feature was left out, where there is a reason', () => {
    render(
      <ConceptDetailsPanel
        concept={concept({
          requestedFeaturesIncluded: [
            { feature: 'seating', label: 'Seating', included: true },
            {
              feature: 'water',
              label: 'Water feature',
              included: false,
              reason: 'No room without losing the lawn.',
            },
          ],
        })}
      />,
    );

    const reasons = screen.getByTestId('excluded-reasons');
    expect(reasons.children).toHaveLength(1);
    expect(reasons).toHaveTextContent('No room without losing the lawn.');
  });

  it('shows no reasons block for a feature that simply did not fit', () => {
    render(
      <ConceptDetailsPanel
        concept={concept({
          requestedFeaturesIncluded: [
            { feature: 'water', label: 'Water feature', included: false },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId('excluded-reasons')).toBeNull();
    expect(screen.getByTestId('requested-water')).toHaveAttribute('data-included', 'false');
  });

  it('renders a concept from before the design agent existed without an empty section', () => {
    render(<ConceptDetailsPanel concept={concept()} />);

    expect(screen.queryByTestId('design-decisions')).toBeNull();
    expect(screen.queryByText('Why this design')).toBeNull();
    expect(screen.getByTestId('details-name')).toHaveTextContent('Terrace and lawn');
  });

  /**
   * A repair is a different claim from a decision — what the plan did *instead*, after the agent
   * scored its own drawing — so it gets its own heading rather than more bullets under "Why this
   * design". Most concepts need none, and those must show nothing at all.
   */
  it('lists what the design agent adjusted after scoring its own plan', () => {
    render(
      <ConceptDetailsPanel
        concept={concept({
          explanation: {
            strategy: 'terrace_and_lawn',
            briefId: 'A',
            intent: 'entertaining',
            emphasis: 'social',
            rationale: '',
            decisions: [],
            excludedFeatures: [],
            repairs: [
              'Moved the garden store out of the utility corner.',
              'Narrowed the terrace, to leave the open ground behind it worth having.',
            ],
          },
        })}
      />,
    );

    const repairs = screen.getByTestId('design-repairs');
    expect(repairs.children).toHaveLength(2);
    expect(repairs).toHaveTextContent('Narrowed the terrace');
  });

  it('shows no adjustments block for a concept that needed none', () => {
    render(
      <ConceptDetailsPanel
        concept={concept({
          explanation: {
            strategy: 'terrace_and_lawn',
            briefId: 'A',
            intent: 'entertaining',
            emphasis: 'social',
            rationale: '',
            decisions: [
              { kind: 'terrace-at-doors', text: 'Put the terrace at the doors.', subjects: ['e1'] },
            ],
            excludedFeatures: [],
            repairs: [],
          },
        })}
      />,
    );

    expect(screen.queryByTestId('design-repairs')).toBeNull();
    expect(screen.queryByText('What was adjusted')).toBeNull();
  });
});
