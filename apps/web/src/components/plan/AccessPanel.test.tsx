import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { gardenDoors } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { AccessPanel } from './AccessPanel';
import { SubStepChecklist } from './SubStepChecklist';

/**
 * Plain DOM, so the whole access flow renders under jsdom: take the door, the street and the
 * gate chips, arm the fence tools, remove a gate, and watch the checklist tick.
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
  store().setMode('access');
});

describe('AccessPanel', () => {
  it('offers the doors, the street and the gate without placing any of them', () => {
    render(<AccessPanel />);

    expect(screen.getByTestId('access-suggest-patio-door')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-front-door')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-street-edge')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-side-gate')).toBeInTheDocument();
    expect(screen.getByTestId('gates-count')).toHaveTextContent('No gate');

    expect(store().present.house!.openings).toEqual([]);
    expect(store().present.gates).toEqual([]);
    expect(store().present.streetEdgeVertexId).toBeNull();
  });

  it('takes the chips, and retires each once taken', () => {
    const { rerender } = render(<AccessPanel />);

    fireEvent.click(screen.getByTestId('access-suggest-patio-door'));
    fireEvent.click(screen.getByTestId('suggest-front-door'));
    fireEvent.click(screen.getByTestId('suggest-street-edge'));
    fireEvent.click(screen.getByTestId('suggest-side-gate'));
    rerender(<AccessPanel />);

    expect(gardenDoors(store().present.house)).toHaveLength(2);
    expect(store().present.streetEdgeVertexId).not.toBeNull();
    expect(store().present.gates).toHaveLength(1);

    expect(screen.queryByTestId('access-suggest-patio-door')).toBeNull();
    expect(screen.queryByTestId('suggest-front-door')).toBeNull();
    expect(screen.queryByTestId('suggest-street-edge')).toBeNull();
    expect(screen.queryByTestId('suggest-side-gate')).toBeNull();
    expect(screen.getByTestId('gates-count')).toHaveTextContent('1 gate');
    expect(screen.getByTestId('street-status')).toHaveTextContent('Street side chosen');
  });

  it('arms and disarms the fence tools', () => {
    const { rerender } = render(<AccessPanel />);

    fireEvent.click(screen.getByTestId('access-tool-gate'));
    expect(store().accessTool).toBe('gate');
    rerender(<AccessPanel />);
    expect(screen.getByTestId('access-tool-gate')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('access-tool-street'));
    expect(store().accessTool).toBe('street');
    fireEvent.click(screen.getByTestId('access-tool-street'));
    expect(store().accessTool).toBeNull();
  });

  it('removes a gate from the list', () => {
    store().addSuggestedGate();
    const [gate] = store().present.gates;
    const { rerender } = render(<AccessPanel />);

    fireEvent.click(screen.getByTestId(`remove-gate-${gate!.id}`));
    rerender(<AccessPanel />);

    expect(store().present.gates).toHaveLength(0);
    expect(screen.getByTestId('gates-count')).toHaveTextContent('No gate');
  });
});

describe('the checklist', () => {
  it('ticks access once a garden door and the street are stated; a gate is optional', () => {
    const { rerender } = render(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-access')).toHaveAttribute('data-done', 'false');

    store().addSuggestedGate();
    rerender(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-access')).toHaveAttribute('data-done', 'false');

    store().addOpening('w2', 'patio-door');
    store().setSuggestedStreetEdge();
    rerender(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-access')).toHaveAttribute('data-done', 'true');
  });

  it('is disabled until a house exists', () => {
    store().removeHouse();
    render(<SubStepChecklist />);
    expect(screen.getByTestId('sub-step-access')).toBeDisabled();
  });
});
