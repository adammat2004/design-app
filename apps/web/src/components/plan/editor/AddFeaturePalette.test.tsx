import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddFeaturePalette } from './AddFeaturePalette';
import { resetPlanEditorStoreForTests } from '@/state/plan-editor-store';

/**
 * The palette is twenty things today and heading for many more as the asset library grows — which
 * is the whole point of the Phase D taxonomy. A grid you have to scan is fine at twenty and useless
 * at eighty, so the search and the group filter went in before they were needed rather than after.
 */

function palette() {
  resetPlanEditorStoreForTests();
  return render(<AddFeaturePalette />);
}

describe('the palette filter', () => {
  it('shows everything by default', () => {
    palette();

    expect(screen.getByTestId('palette-structure')).toBeInTheDocument();
    expect(screen.getByTestId('palette-lawn')).toBeInTheDocument();
    expect(screen.getByTestId('palette-dining-set-4')).toBeInTheDocument();
  });

  it('narrows to a group', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-group-planting'));

    expect(screen.getByTestId('palette-lawn')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-paved-area')).not.toBeInTheDocument();
    // Furniture is a different group, so its whole section goes with it.
    expect(screen.queryByTestId('palette-dining-set-4')).not.toBeInTheDocument();
  });

  it('searches across surfaces and furniture at once', () => {
    palette();
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'lawn' } });

    expect(screen.getByTestId('palette-lawn')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-structure')).not.toBeInTheDocument();
  });

  /** "firepit" has to find "Fire pit", or the search is a trap rather than a shortcut. */
  it('ignores case and punctuation', () => {
    palette();
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'firepit' } });

    expect(screen.getByTestId('palette-fire-pit')).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty grid', () => {
    palette();
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'helicopter' } });

    expect(screen.getByTestId('palette-empty')).toBeInTheDocument();
  });

  /**
   * Filtering is a *view* of the palette and must not touch what is being placed. Clearing the
   * search while mid-placement should leave the user still placing the thing they picked.
   */
  it('does not disturb the placement in hand', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-lawn'));
    expect(screen.getByTestId('palette-lawn')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('palette-group-planting'));
    expect(screen.getByTestId('palette-lawn')).toHaveAttribute('aria-pressed', 'true');
  });
});
