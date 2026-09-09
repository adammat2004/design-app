import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetImageryStoreForTests } from '@/state/imagery-store';
import { MappingMethodPanel } from './MappingMethodPanel';

/** Plain DOM, no Konva. The imagery store is seeded directly so no request is ever made. */
const store = () => useBoundaryStore.getState();

const config = {
  provider: 'test',
  tileTemplate: 'http://localhost:3001/imagery/tiles/{z}/{x}/{y}',
  retinaTemplate: null,
  delivery: 'proxy' as const,
  attribution: '© Test imagery',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256 as const,
};

beforeEach(() => {
  resetBoundaryStoreForTests();
});

describe('the mapping method choice', () => {
  it('offers aerial mapping when the server has imagery', () => {
    resetImageryStoreForTests({ status: 'ready', config });
    render(<MappingMethodPanel />);

    const aerial = screen.getByTestId('method-aerial');
    expect(aerial).toBeEnabled();
    fireEvent.click(aerial);
    expect(store().mappingMethod).toBe('aerial');
    expect(store().snapEnabled).toBe(false);
  });

  it('disables aerial mapping, and says why, when the server has none', () => {
    resetImageryStoreForTests({ status: 'unavailable', config: null });
    render(<MappingMethodPanel />);

    expect(screen.getByTestId('method-aerial')).toBeDisabled();
    expect(screen.getByTestId('method-aerial')).toHaveTextContent('not set up on this server');
  });

  it('always offers measurements, which keep the snaps on', () => {
    resetImageryStoreForTests({ status: 'unavailable', config: null });
    render(<MappingMethodPanel />);

    fireEvent.click(screen.getByTestId('method-manual'));
    expect(store().mappingMethod).toBe('manual');
    expect(store().snapEnabled).toBe(true);
  });
});
