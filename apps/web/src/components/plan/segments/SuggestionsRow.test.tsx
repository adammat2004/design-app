import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { gardenDoors } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { SubStepChecklist } from '../SubStepChecklist';
import { SuggestionsRow } from './SuggestionsRow';

/**
 * What is left of the Access sub-step: the four inferences, offered one tap at a time, each
 * retiring once its fact is stated. Everything else it did — placing a gate on a chosen side,
 * naming the street, what a side is made of — lives on the side and wall editors now.
 */

const store = () => useBoundaryStore.getState();

beforeEach(() => {
  resetBoundaryStoreForTests();
  const { addVertexAt, closeShape } = store();
  addVertexAt({ x: 0, y: 0 });
  addVertexAt({ x: 20, y: 0 });
  addVertexAt({ x: 20, y: 16 });
  addVertexAt({ x: 0, y: 16 });
  closeShape();
  store().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
});

describe('SuggestionsRow', () => {
  it('offers the doors, the street and the gate without placing any of them', () => {
    render(<SuggestionsRow />);

    expect(screen.getByTestId('suggest-patio-door')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-front-door')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-street-edge')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-side-gate')).toBeInTheDocument();
    expect(screen.getByTestId('gates-count')).toHaveTextContent('No gate');

    expect(store().present.house!.openings).toEqual([]);
    expect(store().present.gates).toEqual([]);
    expect(store().present.streetEdgeVertexId).toBeNull();
  });

  it('takes the chips, and retires each once taken', () => {
    const { rerender } = render(<SuggestionsRow />);

    fireEvent.click(screen.getByTestId('suggest-patio-door'));
    fireEvent.click(screen.getByTestId('suggest-front-door'));
    fireEvent.click(screen.getByTestId('suggest-street-edge'));
    fireEvent.click(screen.getByTestId('suggest-side-gate'));
    rerender(<SuggestionsRow />);

    expect(gardenDoors(store().present.house)).toHaveLength(2);
    expect(store().present.streetEdgeVertexId).not.toBeNull();
    expect(store().present.gates).toHaveLength(1);

    expect(screen.queryByTestId('suggest-patio-door')).toBeNull();
    expect(screen.queryByTestId('suggest-front-door')).toBeNull();
    expect(screen.queryByTestId('suggest-street-edge')).toBeNull();
    expect(screen.queryByTestId('suggest-side-gate')).toBeNull();
    expect(screen.getByTestId('gates-count')).toHaveTextContent('1 gate');
    expect(screen.getByTestId('street-status')).toHaveTextContent('Street side chosen');
  });

  it('shows nothing at all before there is a house to describe', () => {
    store().removeHouse();
    render(<SuggestionsRow />);

    expect(screen.queryByTestId('suggestions-row')).toBeNull();
  });
});

describe('the checklist', () => {
  it('ticks the details once a garden door and the street are stated; a gate is optional', () => {
    const { rerender } = render(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-details')).toHaveAttribute('data-done', 'false');

    store().addSuggestedGate();
    rerender(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-details')).toHaveAttribute('data-done', 'false');

    store().addOpening('w2', 'patio-door');
    store().setSuggestedStreetEdge();
    rerender(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-details')).toHaveAttribute('data-done', 'true');
  });

  it('says the step is optional, because it is', () => {
    render(<SubStepChecklist />);

    expect(screen.getByTestId('sub-step-details')).toHaveTextContent(/optional/i);
  });

  it('is disabled until a house exists', () => {
    store().removeHouse();
    render(<SubStepChecklist />);

    expect(screen.getByTestId('sub-step-details')).toBeDisabled();
  });
});
