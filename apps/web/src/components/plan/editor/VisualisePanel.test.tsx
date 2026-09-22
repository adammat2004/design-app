import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { VisualisePanel } from './VisualisePanel';

/**
 * The two controls above Visualise, and the line that says what the picture is lit by.
 *
 * `VisualiseView` owns a WebGL context, so it is stubbed out: what is being tested here is the
 * panel's own contract — that the time of day appears only for a located plan, that an unlocated
 * one says which light it is drawn with rather than leaving the user to guess, and that shadows
 * can be turned off without the plan itself changing.
 */

vi.mock('./VisualiseView', () => ({ VisualiseView: () => <div data-testid="visualise-view" /> }));

const editor = () => usePlanEditorStore.getState();

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
});

describe('what the picture is lit by', () => {
  it('names the conventional light, and offers the way to the real sun', () => {
    render(<VisualisePanel />);

    expect(screen.getByTestId('conventional-light')).toHaveTextContent('Conventional light');
    expect(screen.queryByTestId('sun-time')).not.toBeInTheDocument();
  });

  it('shows the time of day once the plan knows where on Earth it is', () => {
    useBoundaryStore.getState().setLocation({ latitude: 53.4, longitude: -2.98 });
    render(<VisualisePanel />);

    expect(screen.getByTestId('sun-time')).toBeInTheDocument();
    expect(screen.queryByTestId('conventional-light')).not.toBeInTheDocument();
  });
});

describe('the shadows toggle', () => {
  it('starts on, because a garden with nothing attached to the ground reads as a diagram', () => {
    render(<VisualisePanel />);

    expect(screen.getByTestId('toggle-shadows')).toHaveAttribute('aria-checked', 'true');
  });

  it('turns them off as a view preference, touching nothing about the design', () => {
    render(<VisualisePanel />);
    const before = editor().present;

    fireEvent.click(screen.getByTestId('toggle-shadows'));

    expect(editor().shadowsVisible).toBe(false);
    expect(screen.getByTestId('toggle-shadows')).toHaveAttribute('aria-checked', 'false');
    // The drawing changed; the plan did not. Same guarantee the grid and the maturity slider give.
    expect(editor().present).toBe(before);
    expect(editor().past).toHaveLength(0);
  });
});
