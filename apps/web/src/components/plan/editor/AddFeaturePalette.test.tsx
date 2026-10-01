import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddFeaturePalette } from './AddFeaturePalette';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * The palette is a rail of categories and one category at a time. Eighty-odd things in one column
 * was a list to scroll rather than a toolbox, so what these hold is that every category is one
 * click away, search still reaches across all of them, and choosing a tile arms exactly what it did.
 */

function palette() {
  resetPlanEditorStoreForTests();
  return render(<AddFeaturePalette />);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('the rail', () => {
  it('opens on the surfaces, and shows one category at a time', () => {
    palette();
    expect(screen.getByTestId('palette-group-surfaces')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('palette-lawn')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-dining-set-4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('palette-group-furniture'));
    expect(screen.getByTestId('palette-dining-set-4')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-lawn')).not.toBeInTheDocument();
  });

  it('moves between categories with the arrow keys', () => {
    palette();
    fireEvent.keyDown(screen.getByTestId('palette-group-surfaces'), { key: 'ArrowDown' });
    expect(screen.getByTestId('palette-group-plants')).toHaveAttribute('aria-selected', 'true');
  });

  it('remembers the category it was left on', () => {
    const { unmount } = palette();
    fireEvent.click(screen.getByTestId('palette-group-boundaries'));
    unmount();
    render(<AddFeaturePalette />);
    expect(screen.getByTestId('palette-group-boundaries')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('palette-enclosure-screen')).toBeInTheDocument();
  });
});

describe('plants', () => {
  it('opens the trees and folds the rest, and a folded subgroup opens on a click', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-group-plants'));
    expect(screen.getByTestId('palette-betula-pendula')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-viburnum-tinus')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalogue-subgroup-shrubs'));
    expect(screen.getByTestId('palette-viburnum-tinus')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalogue-subgroup-trees'));
    expect(screen.queryByTestId('palette-betula-pendula')).not.toBeInTheDocument();
  });

  it('are narrowed by what the place asks of them, and say the one fact that matters', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-group-plants'));
    expect(screen.getByTestId('palette-betula-pendula')).toHaveTextContent(/m · sun/);

    fireEvent.click(screen.getByTestId('plant-filter-evergreen'));
    expect(screen.queryByTestId('palette-betula-pendula')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('catalogue-subgroup-shrubs'));
    expect(screen.getByTestId('palette-viburnum-tinus')).toBeInTheDocument();
  });
});

describe('search', () => {
  it('reaches across every category, by either name, and clearing it goes back where it was', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-group-lighting'));
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'Carpinus' } });
    expect(screen.getByTestId('palette-carpinus-betulus-fastigiata')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'firepit' } });
    expect(screen.getByTestId('palette-fire-pit')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: '' } });
    expect(screen.getByTestId('palette-group-lighting')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('palette-light-bollard')).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty grid', () => {
    palette();
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'helicopter' } });
    expect(screen.getByTestId('palette-empty')).toBeInTheDocument();
  });
});

describe('choosing', () => {
  it('arms a surface, a species and a boundary exactly as before, and a second press disarms', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-lawn'));
    expect(usePlanEditorStore.getState().placingCategory).toBe('lawn');
    expect(screen.getByTestId('palette-lawn')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('palette-group-plants'));
    fireEvent.click(screen.getByTestId('palette-betula-pendula'));
    expect(usePlanEditorStore.getState()).toMatchObject({
      placingCategory: 'planting-bed',
      placingPlantId: 'betula-pendula',
      placingSymbol: 'tree-deciduous',
    });

    fireEvent.click(screen.getByTestId('palette-group-boundaries'));
    fireEvent.click(screen.getByTestId('palette-enclosure-hedge'));
    expect(usePlanEditorStore.getState()).toMatchObject({ placingCategory: 'enclosure', placingEnclosure: 'hedge' });
    fireEvent.click(screen.getByTestId('palette-enclosure-hedge'));
    expect(usePlanEditorStore.getState().placingEnclosure).toBeNull();
  });

  /** Switching category is a view of the palette; it must not drop what is in hand. */
  it('keeps the placement in hand while the category changes', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-lawn'));
    fireEvent.click(screen.getByTestId('palette-group-furniture'));
    fireEvent.click(screen.getByTestId('palette-group-surfaces'));
    expect(screen.getByTestId('palette-lawn')).toHaveAttribute('aria-pressed', 'true');
  });

  it('gathers what was chosen under Recent, newest first', () => {
    palette();
    fireEvent.click(screen.getByTestId('palette-lawn'));
    fireEvent.click(screen.getByTestId('palette-group-furniture'));
    fireEvent.click(screen.getByTestId('palette-bench'));
    fireEvent.click(screen.getByTestId('palette-group-recent'));

    const tiles = screen.getByTestId('catalogue-panel-recent').querySelectorAll('[data-testid^="palette-"]');
    expect(Array.from(tiles).map((tile) => tile.getAttribute('data-testid'))).toEqual(['palette-bench', 'palette-lawn']);
  });
});
